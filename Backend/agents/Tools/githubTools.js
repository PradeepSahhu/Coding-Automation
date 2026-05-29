import { Octokit } from "@octokit/rest";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

function getOctokitFromEnv() {
  const token = process.env.GITHUB_ACCESS_TOKEN;

  if (!token) {
    throw new Error("Missing GITHUB_ACCESS_TOKEN in environment");
  }

  return new Octokit({ auth: token });
}

function isPlaceholderValue(value) {
  const normalized = `${value || ""}`.trim().toLowerCase();

  if (!normalized) {
    return true;
  }

  return (
    normalized.includes("your-github-owner") ||
    normalized.includes("your-repo-name") ||
    normalized.includes("<owner>") ||
    normalized.includes("<repo>") ||
    normalized.includes("placeholder")
  );
}

function resolveGitHubTarget({ owner, repo, base }) {
  const envOwner = process.env.GITHUB_REPO_OWNER;
  const envRepo = process.env.GITHUB_REPO_NAME;
  const envBase = process.env.GITHUB_BASE_BRANCH || "main";

  const resolvedOwner = isPlaceholderValue(owner) ? envOwner : owner;
  const resolvedRepo = isPlaceholderValue(repo) ? envRepo : repo;
  const resolvedBase = isPlaceholderValue(base) ? envBase : base;

  if (isPlaceholderValue(resolvedOwner) || isPlaceholderValue(resolvedRepo)) {
    throw new Error(
      "Invalid GitHub target repository. Set GITHUB_REPO_OWNER and GITHUB_REPO_NAME in environment, or provide non-placeholder owner/repo tool inputs.",
    );
  }

  return {
    owner: `${resolvedOwner}`.trim(),
    repo: `${resolvedRepo}`.trim(),
    base: `${resolvedBase}`.trim() || "main",
  };
}

function slugifyFeatureName(featureName) {
  return `${featureName}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildBranchName({ issueId, featureName }) {
  const safeIssueId = `${issueId}`.trim().replace(/[^a-zA-Z0-9-_]/g, "-");
  const safeFeature = slugifyFeatureName(featureName) || "auto-change";
  return `PR/${safeIssueId}/${safeFeature}`;
}

async function getBranchRef({ octokit, owner, repo, branch }) {
  const ref = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });

  return ref.data;
}

async function ensureBranch({ octokit, owner, repo, base, branchName }) {
  let baseRef;
  try {
    baseRef = await getBranchRef({ octokit, owner, repo, branch: base });
  } catch (error) {
    if (error.status === 409 || error.status === 404) {
      console.log(`Base branch ${base} not found. Initializing repository...`);
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: "README.md",
        message: "Initial commit",
        content: Buffer.from("# Project initialized by Agent").toString("base64"),
      });
      // Give GitHub a moment to set the default branch
      await new Promise((resolve) => setTimeout(resolve, 1000));
      baseRef = await getBranchRef({ octokit, owner, repo, branch: base });
    } else {
      throw error;
    }
  }
  try {
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: baseRef.object.sha,
    });
  } catch (error) {
    // Ignore "reference already exists"
    if (error?.status !== 422) {
      throw error;
    }
  }

  const branchRef = await getBranchRef({
    octokit,
    owner,
    repo,
    branch: branchName,
  });

  return branchRef.object.sha;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, { maxRetries = 3, delay = 2000 } = {}) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.warn(`GitHub tool operation failed (attempt ${i + 1}/${maxRetries}):`, error.message);
      if (i < maxRetries - 1) {
        await sleep(delay * (i + 1));
      }
    }
  }
  throw lastError;
}

/**
 * Commits a list of file changes to a specific GitHub branch.
 * Uses a retry mechanism to handle potential conflicts during multi-step git operations.
 */
async function commitFileChanges({
  octokit,
  owner,
  repo,
  branchName,
  commitMessage,
  fileChanges,
}) {
  return withRetry(async () => {
    console.log(`Committing ${fileChanges.length} files to branch ${branchName}...`);
    const branchRef = await getBranchRef({
      octokit,
      owner,
      repo,
      branch: branchName,
    });
    const latestCommitSha = branchRef.object.sha;
    const latestCommit = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: latestCommitSha,
    });

    const treeItems = [];

    for (const file of fileChanges) {
      const blob = await octokit.git.createBlob({
        owner,
        repo,
        content: file.content,
        encoding: "utf-8",
      });

      treeItems.push({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blob.data.sha,
      });
    }

    const tree = await octokit.git.createTree({
      owner,
      repo,
      base_tree: latestCommit.data.tree.sha,
      tree: treeItems,
    });

    const commit = await octokit.git.createCommit({
      owner,
      repo,
      message: commitMessage,
      tree: tree.data.sha,
      parents: [latestCommitSha],
    });

    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branchName}`,
      sha: commit.data.sha,
      force: true,
    });
    console.log(`Successfully committed changes to ${branchName}`);
  });
}

async function createOrReusePullRequest({
  octokit,
  owner,
  repo,
  title,
  head,
  base,
  body,
}) {
  console.log(`Checking for existing PR from ${head} to ${base}...`);
  const existing = await octokit.pulls.list({
    owner,
    repo,
    state: "open",
    head: `${owner}:${head}`,
    base,
    per_page: 1,
  });

  if (existing.data.length > 0) {
    const pr = existing.data[0];
    console.log(`Reusing existing PR #${pr.number}`);
    return pr;
  }

  console.log(`Creating new PR: "${title}"`);
  const response = await octokit.pulls.create({
    owner,
    repo,
    title,
    head,
    base,
    body,
  });

  console.log(`Successfully created PR #${response.data.number}`);
  return response.data;
}

export function createPullRequestTool() {
  return tool(
    async ({
      owner,
      repo,
      issueId,
      featureName,
      title,
      base,
      body,
      commitMessage,
      fileChanges,
    }) => {
      try {
        const octokit = getOctokitFromEnv();
        const target = resolveGitHubTarget({ owner, repo, base });
        const branchName = buildBranchName({ issueId, featureName });

        console.log(`Starting PR creation process for issue ${issueId} in ${target.owner}/${target.repo}`);

        await ensureBranch({
          octokit,
          owner: target.owner,
          repo: target.repo,
          base: target.base,
          branchName,
        });

        await commitFileChanges({
          octokit,
          owner: target.owner,
          repo: target.repo,
          branchName,
          commitMessage: commitMessage || `feat(${issueId}): ${title}`,
          fileChanges,
        });

        const pullRequest = await createOrReusePullRequest({
          octokit,
          owner: target.owner,
          repo: target.repo,
          title,
          head: branchName,
          base: target.base,
          body,
        });

        return JSON.stringify({
          owner: target.owner,
          repo: target.repo,
          id: pullRequest.id,
          number: pullRequest.number,
          url: pullRequest.html_url,
          state: pullRequest.state,
          branchName,
        });
      } catch (error) {
        console.error("Critical failure in create_github_pull_request tool:", error);
        throw error;
      }
    },
    {
      name: "create_github_pull_request",
      description:
        "Create branch PR/<issueId>/<feature-name>, commit requested file changes, and open/reuse a pull request.",
      schema: z.object({
        owner: z
          .string()
          .optional().nullable()
          .describe(
            "GitHub repository owner, e.g. octocat. Optional if GITHUB_REPO_OWNER is set.",
          ),
        repo: z
          .string()
          .optional().nullable()
          .describe(
            "GitHub repository name. Optional if GITHUB_REPO_NAME is set.",
          ),
        issueId: z
          .string()
          .describe("Issue id for branch naming, e.g. STONE-123"),
        featureName: z
          .string()
          .describe("Feature name used in branch naming, e.g. add-login-flow"),
        title: z.string().describe("Pull request title"),
        base: z
          .string()
          .optional().nullable()
          .describe(
            "Target branch name, e.g. main. Optional if GITHUB_BASE_BRANCH is set.",
          ),
        body: z.string().optional().nullable().describe("Pull request description/body"),
        commitMessage: z
          .string()
          .optional().nullable()
          .describe("Commit message for file changes"),
        fileChanges: z
          .array(
            z.object({
              path: z.string().describe("Repository relative file path"),
              content: z
                .string()
                .describe("Full file content after applying instruction"),
            }),
          )
          .min(1)
          .describe("List of file changes to commit"),
      }),
    },
  );
}

export function createReadGithubFileTool() {
  return tool(
    async ({ owner, repo, path, branch }) => {
      try {
        const octokit = getOctokitFromEnv();
        const target = resolveGitHubTarget({ owner, repo, base: branch });
        
        const response = await octokit.repos.getContent({
          owner: target.owner,
          repo: target.repo,
          path,
          ref: target.base,
        });

        if (Array.isArray(response.data)) {
          return JSON.stringify(
            response.data.map((item) => ({ name: item.name, type: item.type, path: item.path }))
          );
        }

        if (response.data.type === "file" && response.data.content) {
          const buffer = Buffer.from(response.data.content, "base64");
          return buffer.toString("utf8");
        }

        return "Could not read file content. It may not be a file or is empty.";
      } catch (error) {
        if (error.status === 404) {
          return `File or directory not found at path: ${path}`;
        }
        console.error("Error reading GitHub file:", error);
        return `Error reading file: ${error.message}`;
      }
    },
    {
      name: "read_github_repo_file",
      description: "Read the contents of a file or directory from the GitHub repository.",
      schema: z.object({
        owner: z.string().optional().nullable().describe("GitHub repository owner. Optional if environment variable is set."),
        repo: z.string().optional().nullable().describe("GitHub repository name. Optional if environment variable is set."),
        path: z.string().describe("Path to the file or directory in the repository"),
        branch: z.string().optional().nullable().describe("Branch to read from. Defaults to the base branch."),
      }),
    }
  );
}
