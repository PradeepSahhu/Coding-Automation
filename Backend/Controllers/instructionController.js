import { getAllInstructions } from "../Repository/instructionRepository.js";

export const getInstructions = async (req, res) => {
  try {
    const instructions = await getAllInstructions();
    return res.status(200).json({ success: true, instructions });
  } catch (error) {
    console.error("Error fetching instructions:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const healthCheck = (req, res) => {
  res.status(200).json({
    success: true,
    message: "Coding Automation Backend is healthy",
    timestamp: new Date().toISOString(),
  });
};
