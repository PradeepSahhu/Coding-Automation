import express from "express";
import fs from "fs";
import crypto from "crypto";
import "dotenv/config";
import {
  handlePullRequestChangesRequested,
  handlePullRequestClosedWithoutMerge,
  handlePullRequestMerged,
  startAgentWorker,
} from "./agents/agentWorker.js";
import {
  createInstructionFromJiraAssignment,
  getInstructionByIssueId,
} from "./Repository/instructionRepository.js";

const app = express();

function parseGitHubWebhookBody(body) {
  if (Buffer.isBuffer(body)) {
    const text = body.toString("utf8");
    return {
      rawBody: body,
      payload: JSON.parse(text),
    };
  }

  if (typeof body === "string") {
    return {
      rawBody: Buffer.from(body, "utf8"),
      payload: JSON.parse(body),
    };
  }

  if (body && typeof body === "object") {
    const text = JSON.stringify(body);
    return {
      rawBody: Buffer.from(text, "utf8"),
      payload: body,
    };
  }

  throw new Error("GitHub webhook body is empty or unsupported");
}

function verifyGitHubWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!secret) {
    return true;
  }

  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expectedSignature = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;

  const provided = Buffer.from(signatureHeader, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");

  if (provided.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(provided, expected);
}

function getAssigneeIdentity(assignee) {
  if (!assignee) {
    return null;
  }

  return {
    accountId: assignee.accountId || null,
    emailAddress: assignee.emailAddress || null,
    displayName: assignee.displayName || null,
  };
}

function normalize(value) {
  return `${value || ""}`.trim().toLowerCase();
}

function isAssignedToMe(assignee) {
  const identity = getAssigneeIdentity(assignee);

  if (!identity) {
    return false;
  }

  const targetAccountId = process.env.JIRA_ASSIGNEE_ACCOUNT_ID;
  const targetEmail = process.env.JIRA_ASSIGNEE_EMAIL;
  const targetDisplayName = process.env.JIRA_ASSIGNEE_DISPLAY_NAME;

  if (targetAccountId && identity.accountId === targetAccountId) {
    return true;
  }

  if (
    targetEmail &&
    normalize(identity.emailAddress) === normalize(targetEmail)
  ) {
    return true;
  }

  if (
    targetDisplayName &&
    normalize(identity.displayName) === normalize(targetDisplayName)
  ) {
    return true;
  }

  return false;
}

function shouldCreateInstructionFromJira(payload) {
  const eventType = `${payload?.webhookEvent || ""}`;
  const assignee = payload?.issue?.fields?.assignee;

  if (
    eventType === "jira:issue_created" ||
    eventType === "jira:issue_updated"
  ) {
    return isAssignedToMe(assignee);
  }

  return false;
}

app.post("/github-webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const signature = req.headers["x-hub-signature-256"];
    const event = req.headers["x-github-event"];
    const { rawBody, payload } = parseGitHubWebhookBody(req.body);

    if (!verifyGitHubWebhookSignature(rawBody, signature)) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid GitHub signature" });
    }

    if (event === "ping") {
      return res.status(200).json({
        success: true,
        message: "GitHub webhook ping received",
        zen: payload?.zen || null,
      });
    }

    if (event === "pull_request") {
      const owner = payload?.repository?.owner?.login;
      const repo = payload?.repository?.name;
      const number = payload?.pull_request?.number;

      if (!owner || !repo || !number) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid pull_request payload" });
      }

      if (payload?.action === "closed" && payload?.pull_request?.merged) {
        const result = await handlePullRequestMerged({ owner, repo, number });
        return res.status(200).json({ success: true, ...result });
      }

      if (payload?.action === "closed" && !payload?.pull_request?.merged) {
        const result = await handlePullRequestClosedWithoutMerge({
          owner,
          repo,
          number,
        });
        return res.status(200).json({ success: true, ...result });
      }

      return res.status(200).json({
        success: true,
        ignored: true,
        reason: "Unhandled pull_request action",
      });
    }

    if (event === "pull_request_review" && payload?.action === "submitted") {
      const owner = payload?.repository?.owner?.login;
      const repo = payload?.repository?.name;
      const number = payload?.pull_request?.number;
      const reviewState = payload?.review?.state;

      if (!owner || !repo || !number) {
        return res.status(400).json({
          success: false,
          message: "Invalid pull_request_review payload",
        });
      }

      if (`${reviewState}`.toLowerCase() !== "changes_requested") {
        return res.status(200).json({
          success: true,
          ignored: true,
          reason: "Review state is not changes_requested",
        });
      }

      const feedback = payload?.review?.body || "Reviewer requested changes";
      const result = await handlePullRequestChangesRequested({
        owner,
        repo,
        number,
        feedback,
        source: "pull_request_review",
      });

      return res.status(200).json({ success: true, ...result });
    }

    if (
      event === "issue_comment" &&
      payload?.action === "created" &&
      payload?.issue?.pull_request
    ) {
      const owner = payload?.repository?.owner?.login;
      const repo = payload?.repository?.name;
      const number = payload?.issue?.number;
      const body = payload?.comment?.body || "";
      const shouldTrigger = body.toLowerCase().includes("[agent-fix]");

      if (!owner || !repo || !number) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid issue_comment payload" });
      }

      if (!shouldTrigger) {
        return res.status(200).json({
          success: true,
          ignored: true,
          reason: "Issue comment missing [agent-fix] trigger",
        });
      }

      const result = await handlePullRequestChangesRequested({
        owner,
        repo,
        number,
        feedback: body,
        source: "issue_comment",
      });

      return res.status(200).json({ success: true, ...result });
    }

    return res.status(200).json({
      success: true,
      ignored: true,
      reason: `Unhandled event '${event}'`,
    });
  } catch (error) {
    console.error("Error handling GitHub webhook:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/jira-webhook", express.json(), async (req, res) => {
  try {
    console.log("Jira webhook received");

    const data = req.body;
    console.log(data.webhookEvent);

    await fs.promises.appendFile(
      "webhook-data.json",
      JSON.stringify(data, null, 2),
    );

    if (!shouldCreateInstructionFromJira(data)) {
      return res.status(200).json({
        success: true,
        created: false,
        reason: "Jira event did not assign issue to configured user",
      });
    }

    const issueId = data?.issue?.key;
    const existing = await getInstructionByIssueId({ issueId });

    if (
      existing &&
      (existing.status === "pending" || existing.status === "in_progress")
    ) {
      return res.status(200).json({
        success: true,
        created: false,
        reason: `Instruction for ${issueId} already exists with status '${existing.status}'`,
        instruction: existing,
      });
    }
    const issueType = data?.issue?.fields?.issuetype?.name;
    const summary = data?.issue?.fields?.summary;
    const descriptionValue = data?.issue?.fields?.description;
    const description =
      typeof descriptionValue === "string"
        ? descriptionValue
        : JSON.stringify(descriptionValue || "");

    if (!issueId) {
      return res.status(400).json({
        success: false,
        message: "Jira payload missing issue key",
      });
    }

    const inserted = await createInstructionFromJiraAssignment({
      issueId,
      issueType,
      summary,
      description,
      source: "jira-webhook-assigned",
    });

    return res.status(200).json({
      success: true,
      created: true,
      instruction: inserted,
    });
  } catch (error) {
    console.error("Error handling Jira webhook:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

async function bootstrap() {
  await startAgentWorker();

  app.listen(3000, () => {
    console.log("Running on port 3000");
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start backend:", error);
  process.exit(1);
});
