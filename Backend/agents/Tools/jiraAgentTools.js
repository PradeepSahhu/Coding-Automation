import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { 
  getJiraIssueDetails, 
  transitionIssueToInProgress, 
  transitionIssueToDone 
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

  return [getDetailsTool];
}
