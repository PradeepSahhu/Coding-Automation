import { AsyncLocalStorage } from "async_hooks";
import { pool } from "../Repository/instructionRepository.js";

export const logStorage = new AsyncLocalStorage();

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

async function saveAgentLog(instructionId, message) {
  try {
    await pool.query(
      "INSERT INTO agent_execution_logs (instruction_id, log_line) VALUES ($1, $2)",
      [instructionId, message]
    );
  } catch (err) {
    originalError("Failed to save agent log:", err);
  }
}

console.log = (...args) => {
  originalLog(...args);
  const store = logStorage.getStore();
  if (store && store.instructionId) {
    const message = args
      .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
      .join(" ");
    saveAgentLog(store.instructionId, message);
  }
};

console.warn = (...args) => {
  originalWarn(...args);
  const store = logStorage.getStore();
  if (store && store.instructionId) {
    const message = args
      .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
      .join(" ");
    saveAgentLog(store.instructionId, `[WARN] ${message}`);
  }
};

console.error = (...args) => {
  originalError(...args);
  const store = logStorage.getStore();
  if (store && store.instructionId) {
    const message = args
      .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
      .join(" ");
    saveAgentLog(store.instructionId, `[ERROR] ${message}`);
  }
};

export async function logToDb(level, message, context = null) {
  try {
    const query = `
      INSERT INTO logs (level, message, context)
      VALUES ($1, $2, $3)
      RETURNING id;
    `;
    await pool.query(query, [level, message, context ? JSON.stringify(context) : null]);
  } catch (error) {
    originalError("Failed to log to database:", error);
  }
}

export const logger = {
  info: (msg, ctx) => {
    console.log(`[INFO] ${msg}`, ctx || "");
    logToDb("info", msg, ctx);
  },
  error: (msg, ctx) => {
    console.error(`[ERROR] ${msg}`, ctx || "");
    logToDb("error", msg, ctx);
  },
  warn: (msg, ctx) => {
    console.warn(`[WARN] ${msg}`, ctx || "");
    logToDb("warn", msg, ctx);
  }
};
