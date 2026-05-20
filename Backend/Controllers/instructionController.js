import { getAllInstructions, pool } from "../Repository/instructionRepository.js";

export const getInstructions = async (req, res) => {
  try {
    const instructions = await getAllInstructions();
    return res.status(200).json({ success: true, instructions });
  } catch (error) {
    console.error("Error fetching instructions:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getLogs = async (req, res) => {
  try {
    const query = `SELECT * FROM logs ORDER BY timestamp DESC LIMIT 50`;
    const result = await pool.query(query);
    return res.status(200).json({ success: true, logs: result.rows });
  } catch (error) {
    console.error("Error fetching logs:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Simple health check endpoint to verify that the backend server is running.
 * Returns the current timestamp and a success message.
 */
export const healthCheck = (req, res) => {
  res.status(200).json({
    success: true,
    message: "Coding Automation Backend is healthy",
    timestamp: new Date().toISOString(),
  });
};
