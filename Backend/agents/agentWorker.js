import { runDeepseekLangGraphAgent } from "./deepseekLangGraphService.js";
import { logStorage, logger } from "../Utility/Logger.js";
import {
  claimNextPendingInstruction,
  createFollowUpInstructionFromPullRequestFeedback,
  createInstructionListenerClient,
  getInstructionByPullRequest,
  insertInstructionIntoDeadLetterQueue,
  markInstructionClosedWithoutMerge,
  markInstructionCompleted,
  markInstructionFailed,
  saveInstructionPullRequest,
  resetInProgressInstructions,
  getInReviewInstructions,
} from "../Repository/instructionRepository.js";
import {
  transitionIssueToDone,
  transitionIssueToInProgress,
} from "./Tools/jiraTools.js";
import { Octokit } from "@octokit/rest";

const NOTIFY_CHANNEL =
  process.env.AGENT_NOTIFY_CHANNEL || "agent_instruction_created";

const parsedMaxWorkers = Number(process.env.AGENT_MAX_CONCURRENT_WORKERS || 10);
const MAX_CONCURRENT_WORKERS =
  Number.isFinite(parsedMaxWorkers) && parsedMaxWorkers > 0
    ? parsedMaxWorkers
    : 10;

const parsedMaxRetries = Number(process.env.AGENT_MAX_RETRIES || 3);
const MAX_RETRIES =
  Number.isFinite(parsedMaxRetries) && parsedMaxRetries >= 0
    ? parsedMaxRetries
    : 3;

const parsedRetryBaseDelay = Number(
  process.env.AGENT_RETRY_BASE_DELAY_MS || 1500,
);
const RETRY_BASE_DELAY_MS =
  Number.isFinite(parsedRetryBaseDelay) && parsedRetryBaseDelay > 0
    ? parsedRetryBaseDelay
    : 1500;

const parsedPollingInterval = Number(process.env.AGENT_POLLING_INTERVAL_MS || 15000);
const POLLING_INTERVAL_MS =
  Number.isFinite(parsedPollingInterval) && parsedPollingInterval > 0
    ? parsedPollingInterval
    : 15000;

const activeWorkers = new Set();
let pumpInProgress = false;
let pumpRequested = false;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function processInstructionRow(row) {
  let lastError = null;
  let isPrFailure = false;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    try {
      if (attempt === 1 && row.issue_id) {
        try {
          await transitionIssueToInProgress(row.issue_id);
          console.log(`Jira issue ${row.issue_id} transitioned to In Progress`);
        } catch (jiraError) {
          console.error(
            `Warning: Failed to transition Jira ${row.issue_id} to In Progress:`,
            jiraError,
          );
        }
      }

      const agentResult = await runDeepseekLangGraphAgent({
        instructionId: row.id,
      });

      if (!agentResult.pullRequests?.length) {
        const diagnostics = agentResult.diagnostics || {};
        isPrFailure = true;

        let conciseReason = "The agent completed but did not call the pull request tool.";
        if (Array.isArray(diagnostics.prToolErrors) && diagnostics.prToolErrors.length > 0) {
          const rawErr = diagnostics.prToolErrors[diagnostics.prToolErrors.length - 1];
          conciseReason = `PR Tool Error: ${rawErr.replace(/[\r\n\t]+/g, ' ').slice(0, 150)}`;
        } else if (diagnostics.prToolCallCount > 0) {
          conciseReason = "The agent called the PR tool but the arguments were invalid or empty.";
        }

        throw new Error(conciseReason);
      }

      const primaryPr = agentResult.pullRequests[0];

      await saveInstructionPullRequest({
        instructionId: row.id,
        owner: primaryPr.owner,
        repo: primaryPr.repo,
        number: primaryPr.number,
        url: primaryPr.url,
      });

      console.log(
        `Instruction ${row.id} is in_review and waiting for merge of ${primaryPr.owner}/${primaryPr.repo}#${primaryPr.number}`,
      );
      return;
    } catch (error) {
      lastError = error;
      const canRetry = attempt <= MAX_RETRIES;

      if (!canRetry) {
        break;
      }

      const retryDelay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `Instruction ${row.id} attempt ${attempt} failed. Retrying in ${retryDelay}ms.`,
        error,
      );
      await sleep(retryDelay);
    }
  }

  await markInstructionFailed({
    instructionId: row.id,
    errorMessage: lastError?.message,
    status: isPrFailure ? "failed_pr" : "failed",
  });

  try {
    await insertInstructionIntoDeadLetterQueue({
      instructionId: row.id,
      issueId: row.issue_id,
      instructions: row.instructions,
      errorMessage: lastError?.message,
      attempts: MAX_RETRIES,
    });
  } catch (deadLetterError) {
    console.error(
      `Instruction ${row.id} failed to insert into dead_letter_queue:`,
      deadLetterError,
    );
  }

  console.error(`Instruction ${row.id} failed after retries:`, lastError);
}

function spawnWorker(row) {
  if (row.attempts > 1) {
    console.log(`Retrying previously failed instruction ${row.id} (attempt ${row.attempts})`);
  }
  
  let task;
  logStorage.run({ instructionId: row.id }, () => {
    task = processInstructionRow(row).finally(() => {
      activeWorkers.delete(task);
      void pumpPendingInstructions();
    });
  });

  activeWorkers.add(task);
}

async function pumpPendingInstructions() {
  if (pumpInProgress) {
    pumpRequested = true;
    return;
  }

  pumpInProgress = true;

  try {
    do {
      pumpRequested = false;

      if (process.env.DISABLE_LLM_CALLS === "true") {
        return;
      }

      logger.info("Checking database for pending tasks...");

      while (activeWorkers.size < MAX_CONCURRENT_WORKERS) {
        const row = await claimNextPendingInstruction();

        if (!row) {
          break;
        }

        spawnWorker(row);
      }

      // If another notification arrived while we were claiming jobs, loop again.
    } while (pumpRequested);
  } finally {
    pumpInProgress = false;
  }
}

export async function startAgentWorker() {
  if (process.env.DISABLE_LLM_CALLS === "true") {
    console.warn("LLM calls are globally disabled by DISABLE_LLM_CALLS environment variable. Agent will not claim new tasks.");
  }

  const resetTasks = await resetInProgressInstructions();
  if (resetTasks.length > 0) {
    logger.info(`Reset ${resetTasks.length} stuck 'in_progress' tasks back to 'pending'.`);
  }

  const listener = await createInstructionListenerClient();

  listener.on("error", (err) => {
    console.error("Agent listener client error:", err);
  });

  listener.on("notification", async (msg) => {
    if (msg.channel === NOTIFY_CHANNEL) {
      await pumpPendingInstructions();
    }
  });

  await listener.query(`LISTEN ${NOTIFY_CHANNEL}`);
  await pumpPendingInstructions();

  setInterval(async () => {
    logger.info("Backend is polling database for pending tasks (every 15 seconds)...");
    await pumpPendingInstructions();
    await pollInReviewTasks();
  }, POLLING_INTERVAL_MS);

  console.log(
    `Agent worker listening on Postgres channel '${NOTIFY_CHANNEL}' and polling every ${POLLING_INTERVAL_MS / 1000}s with max concurrency ${MAX_CONCURRENT_WORKERS}`,
  );
}

async function pollInReviewTasks() {
  if (process.env.DISABLE_LLM_CALLS === "true") return;

  try {
    const tasks = await getInReviewInstructions();
    if (tasks.length === 0) return;

    const token = process.env.GITHUB_ACCESS_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) return;

    const octokit = new Octokit({ auth: token });

    for (const task of tasks) {
      try {
        const { data: pr } = await octokit.pulls.get({
          owner: task.pr_owner,
          repo: task.pr_repo,
          pull_number: task.pr_number,
        });

        if (pr.merged) {
          logger.info(`Polling detected PR #${task.pr_number} merged for instruction ${task.id}`);
          await handlePullRequestMerged({ owner: task.pr_owner, repo: task.pr_repo, number: task.pr_number });
        } else if (pr.state === 'closed') {
          logger.info(`Polling detected PR #${task.pr_number} closed without merge for instruction ${task.id}`);
          await handlePullRequestClosedWithoutMerge({ owner: task.pr_owner, repo: task.pr_repo, number: task.pr_number });
        }
      } catch (err) {
        console.error(`Error checking PR status for instruction ${task.id}:`, err);
      }
    }
  } catch (error) {
    console.error("Error in pollInReviewTasks:", error);
  }
}

/**
 * Updates the system state when a Pull Request associated with an instruction is merged.
 * Marks the task as completed and transitions the linked Jira issue to 'Done'.
 */
export async function handlePullRequestMerged({ owner, repo, number }) {
  const record = await getInstructionByPullRequest({ owner, repo, number });

  if (!record) {
    return { handled: false, message: "No linked instruction found" };
  }

  if (record.status === "completed") {
    return {
      handled: true,
      message: `Instruction ${record.id} already completed`,
    };
  }

  if (!record.issue_id) {
    throw new Error(`Instruction ${record.id} has no issue_id`);
  }

  try {
    await transitionIssueToDone(record.issue_id);
    await markInstructionCompleted({ instructionId: record.id });

    return {
      handled: true,
      message: `Instruction ${record.id} marked completed and Jira ${record.issue_id} moved to Done`,
    };
  } catch (error) {
    await markInstructionFailed({
      instructionId: record.id,
      errorMessage: error.message,
    });
    throw error;
  }
}

export async function handlePullRequestChangesRequested({
  owner,
  repo,
  number,
  feedback,
  source,
}) {
  const followUp = await createFollowUpInstructionFromPullRequestFeedback({
    owner,
    repo,
    number,
    feedback,
    source,
  });

  if (!followUp) {
    return { handled: false, message: "No linked instruction found" };
  }

  return {
    handled: true,
    message: `Created follow-up instruction ${followUp.id} from review feedback`,
    followUpInstructionId: followUp.id,
  };
}

export async function handlePullRequestClosedWithoutMerge({
  owner,
  repo,
  number,
}) {
  const updated = await markInstructionClosedWithoutMerge({
    owner,
    repo,
    number,
  });

  if (!updated) {
    return { handled: false, message: "No linked instruction found" };
  }

  return {
    handled: true,
    message: `Instruction ${updated.id} marked failed because PR closed without merge`,
  };
}

