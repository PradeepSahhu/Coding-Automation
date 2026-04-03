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

  return [
    "You are an execution agent.",
    "Always follow the database instructions exactly unless they conflict with safety.",
    "If the instructions require opening a pull request, call the tool create_github_pull_request.",
    "When calling create_github_pull_request, you MUST provide issueId, featureName, base, title, and fileChanges.",
    "fileChanges must contain full updated file content for each changed file.",
    "Use branch format PR/<issueId>/<feature-name> via tool inputs.",
    "Return concise, actionable output.",
    "",
    `Issue Id: ${issueId || "UNKNOWN"}`,
    "",
    "Database instructions:",
    dbInstructions,
    "",
    "User request:",
    userRequest || "No additional user request provided.",
    contextText,
  ].join("\n");
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
