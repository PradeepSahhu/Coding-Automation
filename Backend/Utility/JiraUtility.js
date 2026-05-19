export function getIssueInformation(data) {
  const fields = data?.issue?.fields;

  const issueType = fields?.issuetype?.name;
  const summary = fields?.summary;
  const descriptionText = fields?.description;

  return { issueType, summary, descriptionText };
}

/**
 * Extracts comment information from a Jira webhook payload.
 * Handles both plain text and potentially structured ADF formats.
 */
export function getCommentInformation(data) {
  const commentBody = data?.comment?.body;
  return { commentBody };
}
