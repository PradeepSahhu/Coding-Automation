import crypto from "crypto";
import { parseGitHubWebhookBody } from "../Utility/WebhookUtility.js";

export function verifyGitHubSignature(req, res, next) {
  const signature = req.headers["x-hub-signature-256"];
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!secret) {
    return next();
  }

  try {
    const { rawBody } = parseGitHubWebhookBody(req.body);
    
    if (!signature || !signature.startsWith("sha256=")) {
      return res.status(401).json({ success: false, message: "Missing GitHub signature" });
    }

    const expectedSignature = `sha256=${crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex")}`;

    const provided = Buffer.from(signature, "utf8");
    const expected = Buffer.from(expectedSignature, "utf8");

    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      return res.status(401).json({ success: false, message: "Invalid GitHub signature" });
    }

    next();
  } catch (error) {
    return res.status(400).json({ success: false, message: "Payload verification failed" });
  }
}
