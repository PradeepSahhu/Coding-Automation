import { Client, Pool } from "pg";

const DEFAULT_TABLE_NAME =
  process.env.AGENT_INSTRUCTIONS_TABLE || "agent_instructions";

const dbConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL.includes("uselibpqcompat") 
        ? process.env.DATABASE_URL 
        : `${process.env.DATABASE_URL}${process.env.DATABASE_URL.includes("?") ? "&" : "?"}uselibpqcompat=true`,
      ssl: {
        rejectUnauthorized: false,
      },
    }
  : {
      host: process.env.POSTGRES_HOST || "localhost",
      port: Number(process.env.POSTGRES_PORT || 5432),
      database: process.env.POSTGRES_DB || "agentdb",
      user: process.env.POSTGRES_USER || "agentuser",
      password: process.env.POSTGRES_PASSWORD || "agentpass",
    };

export const pool = new Pool(dbConfig);

function getSafeTableName(tableName = DEFAULT_TABLE_NAME) {
  const safeName = `${tableName}`.replace(/[^a-zA-Z0-9_]/g, "");

  if (!safeName) {
    throw new Error("Invalid AGENT_INSTRUCTIONS_TABLE value");
  }

  return safeName;
}

export async function getInstructionFromDb({
  instructionId,
  tableName = DEFAULT_TABLE_NAME,
} = {}) {
  const tableRef = getSafeTableName(tableName);
  const sqlById = `SELECT id, issue_id, instructions, status FROM ${tableRef} WHERE id = $1`;
  const sqlLatest = `SELECT id, issue_id, instructions, status FROM ${tableRef} ORDER BY id DESC LIMIT 1`;

  const result = instructionId
    ? await pool.query(sqlById, [instructionId])
    : await pool.query(sqlLatest);

  const row = result.rows?.[0];

  if (!row || !row.instructions) {
    throw new Error(
      `No instruction row found in table '${tableRef}' for id '${instructionId ?? "latest"}'`,
    );
  }

  return {
    id: row.id,
    issueId: row.issue_id,
    status: row.status,
    instructions: row.instructions,
  };
}

export async function claimNextPendingInstruction({
  tableName = DEFAULT_TABLE_NAME,
} = {}) {
  const tableRef = getSafeTableName(tableName);
  const query = `
    WITH next_job AS (
      SELECT id
      FROM ${tableRef}
      WHERE status = 'pending'
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE ${tableRef} AS t
    SET status = 'in_progress'
    FROM next_job
    WHERE t.id = next_job.id
    RETURNING t.id, t.issue_id, t.instructions;
  `;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(query);
    await client.query("COMMIT");
    return result.rows?.[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markInstructionCompleted({
  instructionId,
  tableName = DEFAULT_TABLE_NAME,
} = {}) {
  const tableRef = getSafeTableName(tableName);
  const query = `
    UPDATE ${tableRef}
    SET status = 'completed', completed_at = NOW(), last_error = NULL
    WHERE id = $1;
  `;

  await pool.query(query, [instructionId]);
}

export async function markInstructionFailed({
  instructionId,
  errorMessage,
  tableName = DEFAULT_TABLE_NAME,
} = {}) {
  const tableRef = getSafeTableName(tableName);
  const query = `
    UPDATE ${tableRef}
    SET status = 'failed', last_error = $2
    WHERE id = $1;
  `;

  await pool.query(query, [
    instructionId,
    errorMessage?.slice(0, 4000) || null,
  ]);
}

export async function saveInstructionPullRequest({
  instructionId,
  owner,
  repo,
  number,
  url,
  tableName = DEFAULT_TABLE_NAME,
} = {}) {
  const tableRef = getSafeTableName(tableName);
  const query = `
    UPDATE ${tableRef}
    SET pr_owner = $2, pr_repo = $3, pr_number = $4, pr_url = $5, status = 'in_review', last_error = NULL
    WHERE id = $1;
  `;

  await pool.query(query, [
    instructionId,
    owner,
    repo,
    Number(number),
    url || null,
  ]);
}

export async function getInstructionByPullRequest({
  owner,
  repo,
  number,
  tableName = DEFAULT_TABLE_NAME,
} = {}) {
  const tableRef = getSafeTableName(tableName);
  const query = `
    SELECT id, issue_id, status, pr_owner, pr_repo, pr_number
    FROM ${tableRef}
    WHERE pr_owner = $1 AND pr_repo = $2 AND pr_number = $3
    LIMIT 1;
  `;

  const result = await pool.query(query, [owner, repo, Number(number)]);
  return result.rows?.[0] || null;
}

export async function createFollowUpInstructionFromPullRequestFeedback({
  owner,
  repo,
  number,
  feedback,
  source = "github-review",
  tableName = DEFAULT_TABLE_NAME,
} = {}) {
  const tableRef = getSafeTableName(tableName);
  const linked = await getInstructionByPullRequest({
    owner,
    repo,
    number,
    tableName,
  });

  if (!linked) {
    return null;
  }

  const issueId = linked.issue_id;
  const nextInstruction = [
    "Reviewer requested updates on existing pull request.",
    `PR: ${owner}/${repo}#${number}`,
    `Source: ${source}`,
    "",
    "Feedback to address:",
    feedback || "No feedback text provided.",
    "",
    "Update the same PR branch with required changes.",
  ].join("\n");

  const query = `
    INSERT INTO ${tableRef} (issue_id, instructions, status, last_error)
    VALUES ($1, $2, 'pending', NULL)
    RETURNING id, issue_id, status;
  `;

  const inserted = await pool.query(query, [issueId, nextInstruction]);
  return inserted.rows?.[0] || null;
}

export async function markInstructionClosedWithoutMerge({
  owner,
  repo,
  number,
  reason = "Pull request closed without merge",
  tableName = DEFAULT_TABLE_NAME,
} = {}) {
  const tableRef = getSafeTableName(tableName);
  const linked = await getInstructionByPullRequest({
    owner,
    repo,
    number,
    tableName,
  });

  if (!linked) {
    return null;
  }

  const query = `
    UPDATE ${tableRef}
    SET status = 'failed',
        last_error = $2
    WHERE id = $1
    RETURNING id, issue_id, status;
  `;

  const updated = await pool.query(query, [linked.id, reason.slice(0, 4000)]);
  return updated.rows?.[0] || null;
}

/**
 * Creates and returns a new PostgreSQL client configured for listening to notifications.
 * Used by the worker to respond to real-time 'LISTEN/NOTIFY' events.
 */
export async function createInstructionListenerClient() {
  const listenerClient = new Client(dbConfig);
  await listenerClient.connect();
  return listenerClient;
}

export async function getInstructionByIssueId({
  issueId,
  tableName = DEFAULT_TABLE_NAME,
} = {}) {
  if (!issueId) {
    return null;
  }

  const tableRef = getSafeTableName(tableName);
  const query = `
    SELECT id, issue_id, status, instructions, pr_owner, pr_repo, pr_number, pr_url
    FROM ${tableRef}
    WHERE issue_id = $1
    ORDER BY id DESC
    LIMIT 1;
  `;

  const result = await pool.query(query, [issueId]);
  return result.rows?.[0] || null;
}

export async function resetFailedInstructionToPending({
  instructionId,
  instructions,
  tableName = DEFAULT_TABLE_NAME,
} = {}) {
  const tableRef = getSafeTableName(tableName);
  const query = `
    UPDATE ${tableRef}
    SET status = 'pending',
        instructions = $2,
        last_error = NULL,
        completed_at = NULL,
        pr_owner = NULL,
        pr_repo = NULL,
        pr_number = NULL,
        pr_url = NULL
    WHERE id = $1
    RETURNING id, issue_id, status, created_at;
  `;

  const result = await pool.query(query, [instructionId, instructions]);
  return result.rows?.[0] || null;
}

export async function createInstructionFromJiraAssignment({
  issueId,
  issueType,
  summary,
  description,
  source = "jira-assigned",
  tableName = DEFAULT_TABLE_NAME,
} = {}) {
  if (!issueId) {
    throw new Error("issueId is required to create Jira instruction");
  }

  const tableRef = getSafeTableName(tableName);
  const instructionText = [
    `A Jira ${issueType || "issue"} has been assigned to you.`,
    `Issue: ${issueId}`,
    `Source: ${source}`,
    "",
    "Task details:",
    `Summary: ${summary || "No summary provided"}`,
    `Description: ${description || "No description provided"}`,
    "",
    "Generate and apply the required code changes, then open/update the PR.",
  ].join("\n");

  const query = `
    INSERT INTO ${tableRef} (issue_id, instructions, status, last_error)
    VALUES ($1, $2, 'pending', NULL)
    RETURNING id, issue_id, status, created_at;
  `;

  const result = await pool.query(query, [issueId, instructionText]);
  return result.rows?.[0] || null;
}

export async function updateInstructionText({
  instructionId,
  instructions,
  tableName = DEFAULT_TABLE_NAME,
} = {}) {
  const tableRef = getSafeTableName(tableName);
  const query = `
    UPDATE ${tableRef}
    SET instructions = $2, created_at = NOW()
    WHERE id = $1 AND status = 'pending'
    RETURNING id, issue_id, status;
  `;

  const result = await pool.query(query, [instructionId, instructions]);
  return result.rows?.[0] || null;
}

export async function insertInstructionIntoDeadLetterQueue({
  instructionId,
  issueId,
  instructions,
  errorMessage,
  attempts,
} = {}) {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS dead_letter_queue (
      id SERIAL PRIMARY KEY,
      instruction_id INTEGER NOT NULL,
      issue_id VARCHAR(20),
      instructions TEXT,
      error_message TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  const insertQuery = `
    INSERT INTO dead_letter_queue (
      instruction_id,
      issue_id,
      instructions,
      error_message,
      attempts
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, instruction_id, issue_id, attempts, failed_at;
  `;

  await pool.query(createTableQuery);

  const result = await pool.query(insertQuery, [
    instructionId,
    issueId,
    instructions,
    errorMessage,
    attempts,
  ]);

  return result.rows?.[0] || null;
}

export async function getAllInstructions({
  tableName = DEFAULT_TABLE_NAME,
} = {}) {
  const tableRef = getSafeTableName(tableName);
  const query = `
    SELECT id, issue_id, instructions, status, last_error, pr_owner, pr_repo, pr_number, pr_url, created_at, completed_at
    FROM ${tableRef}
    ORDER BY created_at DESC;
  `;

  const result = await pool.query(query);
  return result.rows;
}
