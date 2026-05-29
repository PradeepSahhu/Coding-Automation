import "dotenv/config";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { getInstructionFromDb } from "../Repository/instructionRepository.js";
import { createPullRequestTool, createReadGithubFileTool } from "./Tools/githubTools.js";
import { createJiraTools } from "./Tools/jiraAgentTools.js";

function normalizeContentToText(rawContent) {
  if (!rawContent) {
    return "";
  }

  if (typeof rawContent === "string") {
    return rawContent;
  }

  if (Array.isArray(rawContent)) {
    return rawContent
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (typeof part?.text === "string") {
          return part.text;
        }

        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof rawContent === "object") {
    return JSON.stringify(rawContent);
  }

  return `${rawContent}`;
}

function tryParseJsonString(text) {
  if (!text) {
    return null;
  }

  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with fallbacks.
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch {
      // Continue with next fallback.
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const jsonLike = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonLike);
    } catch {
      return null;
    }
  }

  return null;
}

function parsePrToolOutput(rawContent) {
  if (!rawContent) {
    return null;
  }

  if (
    typeof rawContent === "object" &&
    !Array.isArray(rawContent) &&
    rawContent?.owner &&
    rawContent?.repo &&
    rawContent?.number
  ) {
    return rawContent;
  }

  return tryParseJsonString(normalizeContentToText(rawContent));
}

function extractPullRequestDiagnostics(messages = []) {
  const diagnostics = {
    prToolCalled: false,
    prToolCallCount: 0,
    prToolMessageCount: 0,
    prToolErrors: [],
    lastAssistantResponse: null,
  };

  for (const message of messages) {
    const type = `${message?.type || ""}`.toLowerCase();

    if (type === "ai") {
      const toolCalls = Array.isArray(message?.tool_calls)
        ? message.tool_calls
        : [];
      const prCalls = toolCalls.filter(
        (call) => call?.name === "create_github_pull_request",
      );

      if (prCalls.length > 0) {
        diagnostics.prToolCalled = true;
        diagnostics.prToolCallCount += prCalls.length;
      }

      diagnostics.lastAssistantResponse = normalizeContentToText(
        message?.content,
      );
    }

    if (message?.name === "create_github_pull_request") {
      diagnostics.prToolMessageCount += 1;
      const contentText = normalizeContentToText(message?.content).trim();
      const parsed = parsePrToolOutput(message?.content);

      if (!parsed?.owner || !parsed?.repo || !parsed?.number) {
        diagnostics.prToolErrors.push(contentText || "Tool output was empty");
      }
    }
  }

  return diagnostics;
}

function extractPullRequests(messages = []) {
  const pullRequests = [];

  for (const message of messages) {
    if (message?.name !== "create_github_pull_request") {
      continue;
    }

    const parsed = parsePrToolOutput(message.content);

    if (parsed?.owner && parsed?.repo && parsed?.number) {
      pullRequests.push({
        owner: parsed.owner,
        repo: parsed.repo,
        number: parsed.number,
        url: parsed.url,
      });
    }
  }

  return pullRequests;
}

function buildPrompt({ dbInstructions, userRequest, context, issueId }) {
  const contextText = context ? `\nAdditional context:\n${context}` : "";
  const owner = process.env.GITHUB_REPO_OWNER || "";
  const repo = process.env.GITHUB_REPO_NAME || "";
  const base = process.env.GITHUB_BASE_BRANCH || "main";

  return [
    "You are a coding execution agent. Your job is to implement the requested changes and open a GitHub pull request.",
    "",
    "CRITICAL RULES — you MUST follow these without exception:",
    "1. First, you MUST read the repository files using the `read_github_repo_file` tool to understand the existing code. If there are no files in the repository, you should start executing the tasks using Python as the programming language.",
    "2. Next, write out a detailed step-by-step plan of what you intend to do. (This text will be automatically logged to the PostgreSQL database so the user can review it).",
    "3. Finally, execute the tasks by generating the real working code files and calling `create_github_pull_request`.",
    "4. You MUST call the tool `create_github_pull_request` before finishing. This is non-negotiable.",
    "5. Use EXACTLY these GitHub details — do NOT invent or change them:",
    `   - owner: ${owner}`,
    `   - repo: ${repo}`,
    `   - base: ${base}`,
    `   - issueId: ${issueId || "UNKNOWN"}`,
    "",
    "OPTIONAL: If the provided instructions are unclear or you suspect there are recent updates/comments, you MAY call `get_jira_issue_details` to fetch the live context from Jira before implementing.",
    "",
    "Tool call format:",
    "  create_github_pull_request({",
    `    owner: "${owner}",`,
    `    repo: "${repo}",`,
    `    base: "${base}",`,
    `    issueId: "${issueId || "UNKNOWN"}",`,
    "    featureName: <short-slug-of-task>,",
    "    title: <PR title>,",
    "    body: <PR description>,",
    "    commitMessage: <commit message>,",
    "    fileChanges: [{ path: <file path>, content: <full file content> }, ...]",
    "  })",
    "",
    `Issue Id: ${issueId || "UNKNOWN"}`,
    "",
    "Task instructions:",
    dbInstructions,
    "",
    userRequest ? `Additional request:\n${userRequest}` : "",
    contextText,
  ]
    .join("\n")
    .trim();
}

export function createDeepseekModel() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is missing. Set it in Backend/.env or as a system environment variable.");
  }

  const modelName = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

  const model = new ChatOpenAI({
    model: modelName,
    temperature: 0,
    openAIApiKey: apiKey,
    configuration: {
      baseURL: "https://api.deepseek.com",
    },
  });

  // Polyfill bindTools if missing due to @langchain/core version mismatches
  if (typeof model.bindTools !== "function") {
    model.bindTools = (tools, kwargs) => {
      return model.bind({ tools: tools, ...kwargs });
    };
  }

  return model;
}

export async function validateDeepseekModelConfiguration() {
  const modelName = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is missing. Set it in Backend/.env or as a system environment variable.");
  }

  const model = createDeepseekModel();

  try {
    await model.invoke("Reply with exactly: OK");
  } catch (error) {
    const details = error?.message || String(error);
    throw new Error(
      `DeepSeek validation failed. ${details}`,
    );
  }

  return { modelName };
}

export async function runDeepseekLangGraphAgent({
  instructionId,
  userRequest,
  context,
} = {}) {
  const instructionRow = await getInstructionFromDb({ instructionId });

  const model = createDeepseekModel();

  const tools = [createPullRequestTool(), createReadGithubFileTool(), ...createJiraTools()];

  const agent = createReactAgent({
    llm: model,
    tools,
  });

  const prompt = buildPrompt({
    dbInstructions: instructionRow.instructions,
    userRequest,
    context,
    issueId: instructionRow.issueId,
  });

  const result = await agent.invoke(
    {
      messages: [new HumanMessage(prompt)],
    },
    {
      callbacks: [
        {
          handleToolStart(tool, input) {
            console.log(`[Tool Start] Agent is calling tool '${tool.id ? tool.id[tool.id.length - 1] : "unknown"}'`);
            console.log(`[Tool Input]`, input);
          },
          handleToolEnd(output, runId, parentRunId, tags) {
            console.log(`[Tool End] Tool execution completed successfully.`);
          },
          handleToolError(error) {
            console.error(`[Tool Error] Tool execution failed:`, error);
          },
          handleLLMStart() {
            console.log(`[LLM Start] Agent is reasoning...`);
          },
          handleLLMEnd(output) {
            if (output?.generations?.[0]?.[0]?.message?.content) {
               console.log(`[LLM Output] Agent finished reasoning. Output generated.`);
            } else {
               console.log(`[LLM End] Reasoning complete.`);
            }
          },
          handleLLMError(err) {
            console.error(`[LLM Error]`, err);
          }
        },
      ],
    }
  );

  const lastMessage = result.messages[result.messages.length - 1];
  const responseText =
    typeof lastMessage?.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? "", null, 2);

  const pullRequests = extractPullRequests(result.messages);
  const diagnostics = extractPullRequestDiagnostics(result.messages);

  return {
    instructionId: instructionRow.id,
    response: responseText,
    pullRequests,
    diagnostics,
  };
}
