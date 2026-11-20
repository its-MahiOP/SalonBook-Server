import { Router } from "express";
import { getCollection, toObjectId } from "../db/mongo.js";
import { authenticate } from "../middleware/auth.js";
import { badRequest, notFound } from "../utils/ApiError.js";
import { serializeUser } from "../utils/serializers.js";
import {
  optionalString,
  requireString,
  requireUrl,
} from "../utils/validate.js";

const router = Router();
const users = () => getCollection("user");

// GET /api/profile  (current user)
router.get("/", authenticate, async (req, res, next) => {
  try {
    const doc = await users().findOne({ _id: toObjectId(req.authUserId) });
    if (!doc) throw notFound("User not found");
    res.json({ success: true, data: serializeUser(doc) });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/profile  (update own permitted fields only)
router.patch("/", authenticate, async (req, res, next) => {
  try {
    const body = req.body || {};
    const update = {};

    if (body.name !== undefined) {
      update.name = requireString(body.name, "Name", { min: 2, max: 80 });
    }
    if (body.image !== undefined) {
      update.image = body.image ? requireUrl(body.image, "Profile image") : "";
    }
    if (body.phone !== undefined) {
      update.phone = optionalString(body.phone, "Phone", { max: 24 });
    }

    if (!Object.keys(update).length) {
      throw badRequest("No editable profile fields were provided");
    }

    update.updatedAt = new Date();
    const updated = await users().findOneAndUpdate(
      { _id: toObjectId(req.authUserId) },
      { $set: update },
      { returnDocument: "after" }
    );
    if (!updated) throw notFound("User not found");

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: serializeUser(updated),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
