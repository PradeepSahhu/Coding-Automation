import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { 
  getJiraIssueDetails, 
  transitionIssueToInProgress, 
  transitionIssueToDone,
  postJiraComment
} from "./jiraTools.js";

export function createJiraTools() {
  const getDetailsTool = tool(
    async ({ issueKey }) => {
      try {
        const details = await getJiraIssueDetails(issueKey);
        return JSON.stringify(details, null, 2);
      } catch (error) {
        return `Error fetching Jira details: ${error.message}`;
      }
    },
    {
      name: "get_jira_issue_details",
      description: "Fetches the latest summary, description, status, and comments for a Jira issue. Use this if the initial instructions are unclear or if you need to check for recent updates/comments.",
      schema: z.object({
        issueKey: z.string().describe("The Jira issue key, e.g., 'PROJ-123'"),
      }),
    }
  );

  const postCommentTool = tool(
    async ({ issueKey, comment }) => {
      try {
        await postJiraComment(issueKey, comment);
        return `Successfully posted comment to ${issueKey}`;
      } catch (error) {
        return `Error posting Jira comment: ${error.message}`;
      }
    },
    {
      name: "post_jira_comment",
      description: "Posts a comment back to a Jira issue. Use this to provide feedback, ask clarifying questions, or notify users of progress.",
      schema: z.object({
        issueKey: z.string().describe("The Jira issue key, e.g., 'PROJ-123'"),
        comment: z.string().describe("The text of the comment to post"),
      }),
    }
  );

  return [getDetailsTool, postCommentTool];
}
