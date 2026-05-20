import crypto from "crypto";

/**
 * Normalizes the GitHub webhook body into a JSON payload and raw Buffer.
 * Handles Buffer, string, and object inputs for consistent processing.
 */
export function parseGitHubWebhookBody(body) {
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

export function getAssigneeIdentity(assignee) {
  if (!assignee) {
    return null;
  }
  return {
    accountId: assignee.accountId || null,
  };
}

export function isAssignedToMe(assignee) {
  const identity = getAssigneeIdentity(assignee);
  if (!identity) return false;

  const targetAccountId = process.env.JIRA_ASSIGNEE_ACCOUNT_ID;
  return targetAccountId && identity.accountId === targetAccountId;
}
