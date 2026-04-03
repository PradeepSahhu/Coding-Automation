import "dotenv/config";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { getInstructionFromDb } from "../Repository/instructionRepository.js";
import { createPullRequestTool } from "./Tools/githubTools.js";

function parsePrToolOutput(rawContent) {
  if (!rawContent) {
    return null;
  }

  if (typeof rawContent === "string") {
    try {
      return JSON.parse(rawContent);
    } catch {
      return null;
    }
  }

  if (Array.isArray(rawContent)) {
    const textParts = rawContent
      .map((part) => (typeof part?.text === "string" ? part.text : null))
      .filter(Boolean)
      .join("\n");

    if (!textParts) {
      return null;
    }

    try {
      return JSON.parse(textParts);
    } catch {
      return null;
    }
  }

  return null;
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

export async function runGeminiLangGraphAgent({
  instructionId,
  userRequest,
  context,
} = {}) {
  const instructionRow = await getInstructionFromDb({ instructionId });

  const model = new ChatGoogleGenerativeAI({
    model: process.env.GEMINI_MODEL || "gemini-1.5-pro",
    apiKey: process.env.GOOGLE_API_KEY,
    temperature: 0,
  });

  const tools = [createPullRequestTool()];

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

  return {
    instructionId: instructionRow.id,
    response: responseText,
    pullRequests,
  };
}
