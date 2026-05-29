import { logger } from "../Utility/Logger.js";
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
import { getIssueInformation, getCommentInformation } from "../Utility/JiraUtility.js";

/**
 * Handles incoming GitHub webhook events including PR merges, reviews, and comments.
 * Triggers agent actions for PR updates or marks tasks as completed upon merge.
 */
export const githubWebhookHandler = async (req, res) => {
  try {
    const event = req.headers["x-github-event"];
    const { payload } = parseGitHubWebhookBody(req.body);

    if (event !== "push") {
      logger.info(`Received GitHub Webhook: ${event}`, { action: payload?.action });
    }

    if (event === "ping") {
      return res.status(200).json({ success: true, message: "Ping received", zen: payload?.zen });
    }

    if (event === "pull_request") {
      const { owner, login } = payload.repository.owner;
      const repo = payload.repository.name;
      const number = payload.pull_request.number;
      const repoOwner = owner?.login || login; // Handle both payload styles

      if (payload.action === "closed") {
        if (payload.pull_request.merged) {
          logger.info(`GitHub PR #${number} merged webhook received.`, { 
            pr_data: payload.pull_request 
          });
          const result = await handlePullRequestMerged({ owner: repoOwner, repo, number });
          return res.status(200).json({ success: true, ...result });
        } else {
          const result = await handlePullRequestClosedWithoutMerge({ owner: repoOwner, repo, number });
          return res.status(200).json({ success: true, ...result });
        }
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
    const processAll = process.env.PROCESS_ALL_JIRA_ISSUES === "true";

    logger.info(`Received Jira Webhook: ${eventType}`, { 
      issue: data.issue?.key, 
      assignee: assignee?.displayName,
      processAll 
    });

    const issueId = data.issue?.key;
    if (!issueId) return res.status(200).json({ success: true, ignored: true });

    const isAssigned = isAssignedToMe(assignee);
    const shouldProcess = isAssigned || processAll;

    if ((eventType === JiraConstants.CREATED_EVENT || eventType === JiraConstants.UPDATED_EVENT) && shouldProcess) {
      const { issueType, summary, descriptionText } = getIssueInformation(data);
      const description = typeof descriptionText === "string" ? descriptionText : JSON.stringify(descriptionText || "");

      const instructionText = [
        `Issue: ${issueId}`,
        `Summary: ${summary}`,
        `Description: ${description}`,
        "Generate and apply the required code changes."
      ].join("\n");

      const existing = await getInstructionByIssueId({ issueId });

      if (existing && existing.status === "pending") {
        await updateInstructionText({ instructionId: existing.id, instructions: instructionText });
        return res.status(200).json({ success: true, updated: true });
      }

      if (existing && (existing.status === "failed" || existing.status === "failed_pr")) {
        await resetFailedInstructionToPending({ instructionId: existing.id, instructions: instructionText });
        return res.status(200).json({ success: true, reset: true });
      }

      if (!existing) {
        await createInstructionFromJiraAssignment({ issueId, issueType, summary, description, source: "jira-webhook" });
        return res.status(200).json({ success: true, created: true });
      }
    }

    if (eventType === JiraConstants.COMMENT_CREATED_EVENT && shouldProcess) {
      const { commentBody } = getCommentInformation(data);
      const commentText = typeof commentBody === "string" ? commentBody : JSON.stringify(commentBody || "");

      const existing = await getInstructionByIssueId({ issueId });

      if (existing) {
        if (existing.status === "pending") {
          const updatedText = existing.instructions + "\n\nUpdate from Jira Comment:\n" + commentText;
          await updateInstructionText({ instructionId: existing.id, instructions: updatedText });
          return res.status(200).json({ success: true, updated: true });
        }

        if (existing.status === "completed") {
          logger.info(`Ignored Jira comment on issue ${issueId} because the task is already completed.`);
          return res.status(200).json({ success: true, ignored: true, message: "Task is already completed" });
        }

        if (existing.status === "failed" || existing.status === "failed_pr") {
          const updatedText = existing.instructions + "\n\nUpdate from Jira Comment:\n" + commentText;
          await resetFailedInstructionToPending({ instructionId: existing.id, instructions: updatedText });
          return res.status(200).json({ success: true, reset: true });
        }

        // If in_progress or in_review, we ignore Jira comments to prevent creating duplicate concurrent tasks
        logger.info(`Ignored Jira comment on issue ${issueId} because the task is currently ${existing.status}.`);
        return res.status(200).json({ success: true, ignored: true, message: `Task is ${existing.status}` });
      }

      // Only create a brand new task if one never existed at all
      const instructionText = [
        `A new comment has been posted on Jira issue: ${issueId}`,
        `Comment: ${commentText}`,
        "",
        "Analyze this comment and perform the requested work. If changes are needed, update the code and the PR. Post a comment back to Jira if feedback or clarification is needed."
      ].join("\n");

      await createInstructionFromJiraAssignment({ 
        issueId, 
        issueType: data.issue?.fields?.issuetype?.name, 
        summary: data.issue?.fields?.summary, 
        description: instructionText, 
        source: "jira-comment" 
      });
      return res.status(200).json({ success: true, created: true });
    }

    return res.status(200).json({ success: true, ignored: true });
  } catch (error) {
    console.error("Jira Webhook Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
