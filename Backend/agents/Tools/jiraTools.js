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

function normalizeTransitionName(value) {
  return `${value || ""}`
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

export async function transitionIssueToStatus(issueKey, status) {
  const baseUrl = getJiraBaseUrl();
  const authHeader = getJiraAuthHeader();
  const targetStatus = normalizeTransitionName(status || "In Progress");

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
    (item) => normalizeTransitionName(item?.name) === targetStatus,
  );

  if (!transition?.id) {
    const available = (transitionsData.transitions || [])
      .map((item) => item?.name)
      .filter(Boolean)
      .join(", ");

    throw new Error(
      `Jira transition '${status}' not found for issue ${issueKey}. Available transitions: ${available || "none"}`,
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
      `Failed to transition Jira issue ${issueKey} to ${status}: ${details}`,
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
  return transitionIssueToStatus(
    issueKey,
    process.env.JIRA_IN_PROGRESS_TRANSITION_NAME || "In Progress",
  );
}

export async function getJiraIssueDetails(issueKey) {
  const baseUrl = getJiraBaseUrl();
  const authHeader = getJiraAuthHeader();

  const response = await fetch(
    `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
    {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to fetch Jira issue ${issueKey}: ${details}`);
  }

  const data = await response.json();
  return {
    key: data.key,
    summary: data.fields?.summary,
    description: data.fields?.description, // Returns ADF (Atlassian Document Format) or text depending on version
    status: data.fields?.status?.name,
    comments: data.fields?.comment?.comments?.map(c => ({
      author: c.author?.displayName,
      body: c.body,
      created: c.created
    })) || []
  };
}
