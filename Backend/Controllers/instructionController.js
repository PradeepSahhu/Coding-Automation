import { getAllInstructions, getAgentExecutionLogs, pool } from "../Repository/instructionRepository.js";

export const getInstructions = async (req, res) => {
  try {
    const instructions = await getAllInstructions();
    console.log(`Fetched ${instructions.length} instructions`);
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

export const getTasks = async (req, res) => {
  try {
    const query = `
      SELECT id, issue_id, status 
      FROM agent_instructions 
      WHERE status IN ('in_progress', 'in_review', 'completed')
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query);
    return res.status(200).json({ success: true, tasks: result.rows });
  } catch (error) {
    console.error("Error fetching tasks:", error);
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

export const getInstructionLogs = async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await getAgentExecutionLogs(Number(id));
    return res.status(200).json({ success: true, logs });
  } catch (error) {
    console.error("Error fetching instruction logs:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

import { deleteInstruction } from "../Repository/instructionRepository.js";

export const removeInstruction = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await deleteInstruction({ instructionId: Number(id) });
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Instruction not found" });
    }
    return res.status(200).json({ success: true, message: "Instruction removed successfully" });
  } catch (error) {
    console.error("Error removing instruction:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
