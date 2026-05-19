import fs from "fs";
import { 
  handlePullRequestChangesRequested, 
  handlePullRequestClosedWithoutMerge, 
  handlePullRequestMerged 
} from "../agents/agentWorker.js";
import { 
  createInstructionFromJiraAssignment, 
  getInstructionByIssueId, 
  resetFailedInstructionToPending,
  updateInstructionText
} from "../Repository/instructionRepository.js";
import { parseGitHubWebhookBody, isAssignedToMe } from "../Utility/WebhookUtility.js";
import { JiraConstants } from "../Utility/Constants.js";
import { getIssueInformation } from "../Utility/JiraUtility.js";

export const githubWebhookHandler = async (req, res) => {
  try {
    const event = req.headers["x-github-event"];
    const { payload } = parseGitHubWebhookBody(req.body);

    if (event === "ping") {
      return res.status(200).json({ success: true, message: "Ping received", zen: payload?.zen });
    }

    if (event === "pull_request") {
      const { owner, login } = payload.repository.owner;
      const repo = payload.repository.name;
      const number = payload.pull_request.number;
      const repoOwner = owner?.login || login; // Handle both payload styles

      if (payload.action === "closed") {
        const result = payload.pull_request.merged 
          ? await handlePullRequestMerged({ owner: repoOwner, repo, number })
          : await handlePullRequestClosedWithoutMerge({ owner: repoOwner, repo, number });
        return res.status(200).json({ success: true, ...result });
      }
    }

    if (event === "pull_request_review" && payload.action === "submitted") {
      const reviewState = payload.review.state;
      if (reviewState.toLowerCase() === "changes_requested") {
        const result = await handlePullRequestChangesRequested({
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
          number: payload.pull_request.number,
          feedback: payload.review.body || "Reviewer requested changes",
          source: "pull_request_review"
        });
        return res.status(200).json({ success: true, ...result });
      }
    }

    if (event === "issue_comment" && payload.action === "created" && payload.issue.pull_request) {
      const body = payload.comment.body || "";
      if (body.toLowerCase().includes("[agent-fix]")) {
        const result = await handlePullRequestChangesRequested({
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
          number: payload.issue.number,
          feedback: body,
          source: "issue_comment"
        });
        return res.status(200).json({ success: true, ...result });
      }
    }

    return res.status(200).json({ success: true, ignored: true });
  } catch (error) {
    console.error("GitHub Webhook Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const jiraWebhookHandler = async (req, res) => {
  try {
    const data = req.body;
    const eventType = data.webhookEvent;
    const assignee = data.issue?.fields?.assignee;

    await fs.promises.appendFile("webhook-data.json", JSON.stringify(data, null, 2));

    if ((eventType === JiraConstants.CREATED_EVENT || eventType === JiraConstants.UPDATED_EVENT) && isAssignedToMe(assignee)) {
      const issueId = data.issue.key;
      const { issueType, summary, descriptionText } = getIssueInformation(data);
      const description = typeof descriptionText === "string" ? descriptionText : JSON.stringify(descriptionText || "");

      const instructionText = [
        `Issue: ${issueId}`,
        `Summary: ${summary}`,
        `Description: ${description}`,
        "Generate and apply the required code changes."
      ].join("\n");

      const existing = await getInstructionByIssueId({ issueId });
      if (existing && existing.status === "failed") {
        await resetFailedInstructionToPending({ instructionId: existing.id, instructions: instructionText });
        return res.status(200).json({ success: true, reset: true });
      }

      if (!existing) {
        await createInstructionFromJiraAssignment({ issueId, issueType, summary, description, source: "jira-webhook" });
        return res.status(200).json({ success: true, created: true });
      }
    }
    return res.status(200).json({ success: true, ignored: true });
  } catch (error) {
    console.error("Jira Webhook Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
rn res.status(200).json({ success: true, ignored: true });
  } catch (error) {
    console.error("Jira Webhook Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
