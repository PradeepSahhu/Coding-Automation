function getJiraAuthHeader() {
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;

  if (!email || !apiToken) {
    throw new Error("Missing JIRA_EMAIL or JIRA_API_TOKEN in environment");
  }

  const token = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return `Basic ${token}`;
}

function getJiraBaseUrl() {
  const baseUrl = process.env.JIRA_BASE_URL;

  if (!baseUrl) {
    throw new Error("Missing JIRA_BASE_URL in environment");
  }

  return baseUrl.replace(/\/$/, "");
}

export async function transitionIssueToStatus(issueKey, statusName) {
  const baseUrl = getJiraBaseUrl();
  const authHeader = getJiraAuthHeader();
  const targetStatus = (statusName || "In Progress").toLowerCase();

  const transitionsResponse = await fetch(
    `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
    },
  );

  if (!transitionsResponse.ok) {
    const details = await transitionsResponse.text();
    throw new Error(
      `Failed to load Jira transitions for ${issueKey}: ${details}`,
    );
  }

  const transitionsData = await transitionsResponse.json();
  const transition = (transitionsData.transitions || []).find(
    (item) => item?.name?.toLowerCase() === targetStatus,
  );

  if (!transition?.id) {
    throw new Error(
      `Jira transition '${statusName}' not found for issue ${issueKey}`,
    );
  }

  const updateResponse = await fetch(
    `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transition: { id: transition.id },
      }),
    },
  );

  if (!updateResponse.ok) {
    const details = await updateResponse.text();
    throw new Error(
      `Failed to transition Jira issue ${issueKey} to ${statusName}: ${details}`,
    );
  }
}

export async function transitionIssueToDone(issueKey) {
  return transitionIssueToStatus(
    issueKey,
    process.env.JIRA_DONE_TRANSITION_NAME || "Done",
  );
}

export async function transitionIssueToInProgress(issueKey) {
  return transitionIssueToStatus(issueKey, "In Progress");
}
