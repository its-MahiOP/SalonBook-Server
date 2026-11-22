import { Router } from "express";
import { getCollection } from "../db/mongo.js";
import { badRequest } from "../utils/ApiError.js";
import { optionalString, requireString } from "../utils/validate.js";

const router = Router();
const messages = () => getCollection("messages");

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const recentSubmissions = new Map();

/**
 * Very small in-memory throttle for the public contact form. This keeps a
 * single client from filling the inbox without adding an external dependency.
 */
function throttleByIp(req) {
  const key = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const previous = recentSubmissions.get(key) ?? [];
  const recent = previous.filter((time) => now - time < WINDOW_MS);

  if (recent.length >= MAX_PER_WINDOW) {
    throw badRequest("You have sent several messages already. Please try again later.");
  }

  recent.push(now);
  recentSubmissions.set(key, recent);

  // Keep the map from growing without bound on a long-running process.
  if (recentSubmissions.size > 5000) {
    for (const [ip, times] of recentSubmissions) {
      if (times.every((time) => now - time > WINDOW_MS)) recentSubmissions.delete(ip);
    }
  }
}

function validateContactBody(body = {}) {
  const name = requireString(body.name, "Name", { min: 2, max: 80 });
  const email = requireString(body.email, "Email", { min: 5, max: 120 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw badRequest("Email must be a valid email address");
  }

  return {
    name,
    email: email.toLowerCase(),
    phone: optionalString(body.phone, "Phone", { max: 24 }),
    subject: optionalString(body.subject, "Subject", { max: 120 }) || "General enquiry",
    message: requireString(body.message, "Message", { min: 10, max: 2000 }),
  };
}

// POST /api/contact - public contact form
router.post("/", async (req, res, next) => {
  try {
    throttleByIp(req);
    const payload = validateContactBody(req.body);

    const doc = {
      ...payload,
      read: false,
      createdAt: new Date(),
    };

    const result = await messages().insertOne(doc);

    res.status(201).json({
      success: true,
      message: "Thanks for reaching out. We will reply within one business day.",
      data: { id: result.insertedId.toString() },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
