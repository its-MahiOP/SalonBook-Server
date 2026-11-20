import { Router } from "express";
import { getCollection, toIdString, toObjectId } from "../db/mongo.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { badRequest, forbidden, notFound } from "../utils/ApiError.js";
import { serializeUser } from "../utils/serializers.js";
import {
  escapeRegex,
  optionalString,
  requireBoolean,
  requireString,
  requireUrl,
} from "../utils/validate.js";

const router = Router();
const users = () => getCollection("user");
const appointments = () => getCollection("appointments");
const transactions = () => getCollection("transactions");

// GET /api/users  (admin) - registered customers
router.get("/", authenticate, requireRole("admin"), async (req, res, next) => {
  try {
    const { search } = req.query;
    const filter = { role: "customer" };

    if (search && String(search).trim()) {
      const regex = { $regex: escapeRegex(String(search).trim()), $options: "i" };
      filter.$or = [{ name: regex }, { email: regex }, { phone: regex }];
    }

    const docs = await users().find(filter).sort({ createdAt: -1 }).toArray();

    const counts = await appointments()
      .aggregate([
        { $group: { _id: "$customerId", count: { $sum: 1 } } },
      ])
      .toArray();
    const countMap = new Map(counts.map((item) => [toIdString(item._id), item.count]));

    res.json({
      success: true,
      data: docs.map((doc) => ({
        ...serializeUser(doc),
        appointmentCount: countMap.get(toIdString(doc._id)) || 0,
      })),
      total: docs.length,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/users/:id  (admin)
router.get("/:id", authenticate, requireRole("admin"), async (req, res, next) => {
  try {
    const objectId = toObjectId(req.params.id);
    if (!objectId) throw badRequest("Invalid user id");

    const doc = await users().findOne({ _id: objectId });
    if (!doc) throw notFound("User not found");

    const [appointmentCount, paidCount] = await Promise.all([
      appointments().countDocuments({ customerId: objectId }),
      transactions().countDocuments({ customerId: objectId, status: "paid" }),
    ]);

    res.json({
      success: true,
      data: {
        ...serializeUser(doc),
        appointmentCount,
        paidTransactionCount: paidCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/users/:id/block  (admin)
router.patch("/:id/block", authenticate, requireRole("admin"), async (req, res, next) => {
  try {
    const objectId = toObjectId(req.params.id);
    if (!objectId) throw badRequest("Invalid user id");
    const isBlocked = requireBoolean(req.body?.isBlocked, "isBlocked");

    if (toIdString(objectId) === req.authUserId) {
      throw forbidden("You cannot block your own admin account");
    }

    const doc = await users().findOne({ _id: objectId });
    if (!doc) throw notFound("User not found");
    if (doc.role === "admin") {
      throw forbidden("Administrator accounts cannot be blocked");
    }

    const updated = await users().findOneAndUpdate(
      { _id: objectId },
      { $set: { isBlocked } },
      { returnDocument: "after" }
    );

    res.json({
      success: true,
      message: isBlocked
        ? "Customer blocked successfully"
        : "Customer unblocked successfully",
      data: serializeUser(updated),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
