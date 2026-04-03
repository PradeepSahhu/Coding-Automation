export function getIssueInformation(data) {
  const fields = data?.issue?.fields;

  const issueType = fields?.issuetype?.name;
  const summary = fields?.summary;
  const descriptionText = fields?.description;

  return { issueType, summary, descriptionText };
}
