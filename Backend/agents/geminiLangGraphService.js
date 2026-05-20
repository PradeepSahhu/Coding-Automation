import "dotenv/config";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { getInstructionFromDb } from "../Repository/instructionRepository.js";
import { createPullRequestTool } from "./Tools/githubTools.js";
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
    "1. You MUST call the tool `create_github_pull_request` before finishing. This is non-negotiable.",
    "2. Do NOT respond with just text. The ONLY valid output is calling the tool.",
    "3. Generate real working code files for the task described below.",
    "4. fileChanges MUST contain at least one file with full file content.",
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

export async function validateGeminiModelConfiguration() {
  const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is missing. Set it in Backend/.env");
  }

  const model = new ChatGoogleGenerativeAI({
    model: modelName,
    apiKey,
    temperature: 0,
  });

  try {
    // A minimal call verifies both model identifier and API key at startup.
    await model.invoke("Reply with exactly: OK");
  } catch (error) {
    const details = error?.message || String(error);
    throw new Error(
      `Gemini validation failed for model '${modelName}'. ${details}`,
    );
  }

  return { modelName };
}

export async function runGeminiLangGraphAgent({
  instructionId,
  userRequest,
  context,
} = {}) {
  const instructionRow = await getInstructionFromDb({ instructionId });

  const model = new ChatGoogleGenerativeAI({
    model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
    apiKey: process.env.GOOGLE_API_KEY,
    temperature: 0,
  });

  const tools = [createPullRequestTool(), ...createJiraTools()];

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

  const result = await agent.invoke({
    messages: [new HumanMessage(prompt)],
  });

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
