import express from "express";
import cors from "cors";
import "dotenv/config";
import { startAgentWorker } from "./agents/agentWorker.js";
import { validateGeminiModelConfiguration } from "./agents/geminiLangGraphService.js";
import { verifyGitHubSignature } from "./Middleware/authMiddleware.js";
import {
  githubWebhookHandler,
  jiraWebhookHandler,
} from "./Controllers/webhookController.js";
import {
  getInstructions,
  getLogs,
  getTasks,
  healthCheck,
} from "./Controllers/instructionController.js";

const app = express();

app.use(cors({
  origin: 'https://coding-automation-5g8h.vercel.app'
}));

// Health Check
app.get("/", healthCheck);

// Webhook Routes
app.post(
  "/github-webhook",
  express.raw({ type: "application/octet-stream" }),
  verifyGitHubSignature,
  githubWebhookHandler,
);
app.post("/jira-webhook", express.json(), jiraWebhookHandler);

// API Routes
app.get("/api/instructions", getInstructions);
app.get("/api/logs", getLogs);
app.get("/api/tasks", getTasks);

async function bootstrap() {
  const { modelName } = await validateGeminiModelConfiguration();
  console.log(`Gemini model '${modelName}' validated successfully`);

  await startAgentWorker();

  if (process.env.VERCEL) {
    console.log("Running in Vercel environment, skipping app.listen");
    return;
  }

  app.listen(3000, () => {
    console.log("Running on port 3000");
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start backend:", error);
  if (!process.env.VERCEL) {
    process.exit(1);
  }
});

export default app;
