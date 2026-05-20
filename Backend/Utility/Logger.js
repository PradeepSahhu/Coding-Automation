import { pool } from "../Repository/instructionRepository.js";

export async function logToDb(level, message, context = null) {
  try {
    const query = `
      INSERT INTO logs (level, message, context)
      VALUES ($1, $2, $3)
      RETURNING id;
    `;
    await pool.query(query, [level, message, context ? JSON.stringify(context) : null]);
  } catch (error) {
    console.error("Failed to log to database:", error);
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
