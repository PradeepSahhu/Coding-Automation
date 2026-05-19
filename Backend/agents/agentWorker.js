import { runGeminiLangGraphAgent } from "./geminiLangGraphService.js";
import {
  claimNextPendingInstruction,
  createFollowUpInstructionFromPullRequestFeedback,
  createInstructionListenerClient,
  getInstructionByPullRequest,
  insertInstructionIntoDeadLetterQueue,
  markInstructionClosedWithoutMerge,
  markInstructionCompleted,
  markInstructionFailed,
  saveInstructionPullRequest,
} from "../Repository/instructionRepository.js";
import {
  transitionIssueToDone,
  transitionIssueToInProgress,
} from "./Tools/jiraTools.js";

const NOTIFY_CHANNEL =
  process.env.AGENT_NOTIFY_CHANNEL || "agent_instruction_created";

const parsedMaxWorkers = Number(process.env.AGENT_MAX_CONCURRENT_WORKERS || 10);
const MAX_CONCURRENT_WORKERS =
  Number.isFinite(parsedMaxWorkers) && parsedMaxWorkers > 0
    ? parsedMaxWorkers
    : 10;

const parsedMaxRetries = Number(process.env.AGENT_MAX_RETRIES || 3);
const MAX_RETRIES =
  Number.isFinite(parsedMaxRetries) && parsedMaxRetries >= 0
    ? parsedMaxRetries
    : 3;

const parsedRetryBaseDelay = Number(
  process.env.AGENT_RETRY_BASE_DELAY_MS || 1500,
);
const RETRY_BASE_DELAY_MS =
  Number.isFinite(parsedRetryBaseDelay) && parsedRetryBaseDelay > 0
    ? parsedRetryBaseDelay
    : 1500;

const activeWorkers = new Set();
let pumpInProgress = false;
let pumpRequested = false;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function processInstructionRow(row) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    try {
      if (attempt === 1 && row.issue_id) {
        try {
          await transitionIssueToInProgress(row.issue_id);
          console.log(`Jira issue ${row.issue_id} transitioned to In Progress`);
        } catch (jiraError) {
          console.error(
            `Warning: Failed to transition Jira ${row.issue_id} to In Progress:`,
            jiraError,
          );
        }
      }

      const agentResult = await runGeminiLangGraphAgent({
        instructionId: row.id,
      });

      if (!agentResult.pullRequests?.length) {
        const diagnostics = agentResult.diagnostics || {};
        const diagSummary = {
          prToolCalled: diagnostics.prToolCalled || false,
          prToolCallCount: diagnostics.prToolCallCount || 0,
          prToolMessageCount: diagnostics.prToolMessageCount || 0,
          prToolErrors: Array.isArray(diagnostics.prToolErrors)
            ? diagnostics.prToolErrors.slice(-2)
            : [],
          lastAssistantResponse: diagnostics.lastAssistantResponse || null,
        };

        throw new Error(
          `Instruction ${row.id} did not create any PR. Diagnostics: ${JSON.stringify(diagSummary)}`,
        );
      }

      const primaryPr = agentResult.pullRequests[0];

      await saveInstructionPullRequest({
        instructionId: row.id,
        owner: primaryPr.owner,
        repo: primaryPr.repo,
        number: primaryPr.number,
        url: primaryPr.url,
      });

      console.log(
        `Instruction ${row.id} is in_progress and waiting for merge of ${primaryPr.owner}/${primaryPr.repo}#${primaryPr.number}`,
      );
      return;
    } catch (error) {
      lastError = error;
      const canRetry = attempt <= MAX_RETRIES;

      if (!canRetry) {
        break;
      }

      const retryDelay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `Instruction ${row.id} attempt ${attempt} failed. Retrying in ${retryDelay}ms.`,
        error,
      );
      await sleep(retryDelay);
    }
  }

  await markInstructionFailed({
    instructionId: row.id,
    errorMessage: lastError?.message,
  });

  try {
    await insertInstructionIntoDeadLetterQueue({
      instructionId: row.id,
      issueId: row.issue_id,
      instructions: row.instructions,
      errorMessage: lastError?.message,
      attempts: MAX_RETRIES,
    });
  } catch (deadLetterError) {
    console.error(
      `Instruction ${row.id} failed to insert into dead_letter_queue:`,
      deadLetterError,
    );
  }

  console.error(`Instruction ${row.id} failed after retries:`, lastError);
}

function spawnWorker(row) {
  const task = processInstructionRow(row).finally(() => {
    activeWorkers.delete(task);
    void pumpPendingInstructions();
  });

  activeWorkers.add(task);
}

async function pumpPendingInstructions() {
  if (pumpInProgress) {
    pumpRequested = true;
    return;
  }

  pumpInProgress = true;

  try {
    do {
      pumpRequested = false;

      while (activeWorkers.size < MAX_CONCURRENT_WORKERS) {
        const row = await claimNextPendingInstruction();

        if (!row) {
          break;
        }

        spawnWorker(row);
      }

      // If another notification arrived while we were claiming jobs, loop again.
    } while (pumpRequested);
  } finally {
    pumpInProgress = false;
  }
}

export async function startAgentWorker() {
  const listener = await createInstructionListenerClient();

  listener.on("error", (err) => {
    console.error("Agent listener client error:", err);
  });

  listener.on("notification", async (msg) => {
    if (msg.channel === NOTIFY_CHANNEL) {
      await pumpPendingInstructions();
    }
  });

  await listener.query(`LISTEN ${NOTIFY_CHANNEL}`);
  await pumpPendingInstructions();

  setInterval(async () => {
    console.log("Polling database for pending instructions...");
    await pumpPendingInstructions();
  }, POLLING_INTERVAL_MS);

  console.log(
    `Agent worker listening on Postgres channel '${NOTIFY_CHANNEL}' and polling every ${POLLING_INTERVAL_MS / 1000}s with max concurrency ${MAX_CONCURRENT_WORKERS}`,
  );
}

/**
 * Updates the system state when a Pull Request associated with an instruction is merged.
 * Marks the task as completed and transitions the linked Jira issue to 'Done'.
 */
export async function handlePullRequestMerged({ owner, repo, number }) {
  const record = await getInstructionByPullRequest({ owner, repo, number });

  if (!record) {
    return { handled: false, message: "No linked instruction found" };
  }

  if (record.status === "completed") {
    return {
      handled: true,
      message: `Instruction ${record.id} already completed`,
    };
  }

  if (!record.issue_id) {
    throw new Error(`Instruction ${record.id} has no issue_id`);
  }

  try {
    await transitionIssueToDone(record.issue_id);
    await markInstructionCompleted({ instructionId: record.id });

    return {
      handled: true,
      message: `Instruction ${record.id} marked completed and Jira ${record.issue_id} moved to Done`,
    };
  } catch (error) {
    await markInstructionFailed({
      instructionId: record.id,
      errorMessage: error.message,
    });
    throw error;
  }
}

export async function handlePullRequestChangesRequested({
  owner,
  repo,
  number,
  feedback,
  source,
}) {
  const followUp = await createFollowUpInstructionFromPullRequestFeedback({
    owner,
    repo,
    number,
    feedback,
    source,
  });

  if (!followUp) {
    return { handled: false, message: "No linked instruction found" };
  }

  return {
    handled: true,
    message: `Created follow-up instruction ${followUp.id} from review feedback`,
    followUpInstructionId: followUp.id,
  };
}

export async function handlePullRequestClosedWithoutMerge({
  owner,
  repo,
  number,
}) {
  const updated = await markInstructionClosedWithoutMerge({
    owner,
    repo,
    number,
  });

  if (!updated) {
    return { handled: false, message: "No linked instruction found" };
  }

  return {
    handled: true,
    message: `Instruction ${updated.id} marked failed because PR closed without merge`,
  };
}

