import { Router } from "express";
import { getCollection, toObjectId } from "../db/mongo.js";
import { authenticate, optionalAuthenticate, requireRole } from "../middleware/auth.js";
import { CATEGORIES, SERVICE_STATUS } from "../utils/constants.js";
import { badRequest, notFound } from "../utils/ApiError.js";
import { serializeService } from "../utils/serializers.js";
import {
  escapeRegex,
  requireEnum,
  requirePositiveNumber,
  requireString,
  requireUrl,
} from "../utils/validate.js";

const router = Router();
const services = () => getCollection("services");

function validateServiceBody(body, { partial = false } = {}) {
  const data = {};

  if (!partial || body.serviceName !== undefined) {
    data.serviceName = requireString(body.serviceName, "Service name", {
      min: 3,
      max: 100,
    });
  }
  if (!partial || body.category !== undefined) {
    data.category = requireEnum(body.category, "Category", CATEGORIES);
  }
  if (!partial || body.description !== undefined) {
    data.description = requireString(body.description, "Description", {
      min: 10,
      max: 2000,
    });
  }
  if (!partial || body.price !== undefined) {
    data.price = requirePositiveNumber(body.price, "Price", { max: 100000 });
  }
  if (!partial || body.duration !== undefined) {
    data.duration = requirePositiveNumber(body.duration, "Duration", {
      max: 720,
      integer: true,
    });
  }
  if (!partial || body.image !== undefined) {
    data.image = requireUrl(body.image, "Service image");
  }
  if (body.status !== undefined) {
    data.status = requireEnum(body.status, "Status", SERVICE_STATUS);
  }

  if (partial && Object.keys(data).length === 0) {
    throw badRequest("No valid fields were provided to update");
  }

  return data;
}

// GET /api/services/categories
router.get("/categories", async (req, res, next) => {
  try {
    const counts = await services()
      .aggregate([
        { $match: { status: "active" } },
        { $group: { _id: "$category", count: { $sum: 1 } } },
      ])
      .toArray();

    const countMap = new Map(counts.map((item) => [item._id, item.count]));
    const data = CATEGORIES.map((category) => ({
      name: category,
      count: countMap.get(category) || 0,
    }));

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /api/services
router.get("/", optionalAuthenticate, async (req, res, next) => {
  try {
    const isAdmin = req.authUser?.role === "admin";
    const { search, category, sort, status, limit } = req.query;
    const filter = {};

    if (isAdmin && status && SERVICE_STATUS.includes(status)) {
      filter.status = status;
    } else if (!isAdmin) {
      filter.status = "active";
    }

    if (category && category !== "all") {
      if (!CATEGORIES.includes(category)) {
        throw badRequest("Unknown service category");
      }
      filter.category = category;
    }

    if (search && String(search).trim()) {
      filter.serviceName = {
        $regex: escapeRegex(String(search).trim()),
        $options: "i",
      };
    }

    let sortOption = { createdAt: -1 };
    if (sort === "price-asc") sortOption = { price: 1, createdAt: -1 };
    if (sort === "price-desc") sortOption = { price: -1, createdAt: -1 };
    if (sort === "name-asc") sortOption = { serviceName: 1 };
    if (sort === "oldest") sortOption = { createdAt: 1 };

    const parsedLimit = Number(limit);
    const max = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 100)
      : 100;

    // "popular" orders by how often each service has been booked, so the
    // ranking has to be computed from the appointments collection.
    if (sort === "popular") {
      const totals = await getCollection("appointments")
        .aggregate([{ $group: { _id: "$serviceId", bookings: { $sum: 1 } } }])
        .toArray();
      const bookingMap = new Map(totals.map((item) => [String(item._id), item.bookings]));

      const all = await services().find(filter).toArray();
      all.sort((a, b) => {
        const difference =
          (bookingMap.get(String(b._id)) ?? 0) - (bookingMap.get(String(a._id)) ?? 0);
        if (difference !== 0) return difference;
        return new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0);
      });

      const docs = all.slice(0, max).map((doc) => ({
        ...doc,
        bookings: bookingMap.get(String(doc._id)) ?? 0,
      }));

      return res.json({
        success: true,
        data: docs.map(serializeService),
        total: all.length,
      });
    }

    const [docs, total] = await Promise.all([
      services().find(filter).sort(sortOption).limit(max).toArray(),
      services().countDocuments(filter),
    ]);

    res.json({ success: true, data: docs.map(serializeService), total });
  } catch (error) {
    next(error);
  }
});

// GET /api/services/:id
router.get("/:id", optionalAuthenticate, async (req, res, next) => {
  try {
    const objectId = toObjectId(req.params.id);
    if (!objectId) throw badRequest("Invalid service id");

    const service = await services().findOne({ _id: objectId });
    if (!service) throw notFound("Service not found");

    const isAdmin = req.authUser?.role === "admin";
    if (service.status !== "active" && !isAdmin) {
      throw notFound("This service is not available for booking right now");
    }

    res.json({ success: true, data: serializeService(service) });
  } catch (error) {
    next(error);
  }
});

// POST /api/services
router.post("/", authenticate, requireRole("admin"), async (req, res, next) => {
  try {
    const payload = validateServiceBody(req.body);
    const now = new Date();
    const doc = {
      ...payload,
      status: payload.status || "active",
      createdAt: now,
      updatedAt: now,
    };

    const result = await services().insertOne(doc);
    res.status(201).json({
      success: true,
      message: "Service created successfully",
      data: serializeService({ ...doc, _id: result.insertedId }),
    });
  } catch (error) {
    next(error);
  }
});

// PUT or PATCH /api/services/:id
async function updateServiceHandler(req, res, next) {
  try {
    const objectId = toObjectId(req.params.id);
    if (!objectId) throw badRequest("Invalid service id");

    const payload = validateServiceBody(req.body, { partial: true });
    const update = { ...payload, updatedAt: new Date() };

    const result = await services().findOneAndUpdate(
      { _id: objectId },
      { $set: update },
      { returnDocument: "after" }
    );

    if (!result) throw notFound("Service not found");

    res.json({
      success: true,
      message: "Service updated successfully",
      data: serializeService(result),
    });
  } catch (error) {
    next(error);
  }
}

router.put("/:id", authenticate, requireRole("admin"), updateServiceHandler);
router.patch("/:id", authenticate, requireRole("admin"), updateServiceHandler);

// DELETE /api/services/:id
router.delete("/:id", authenticate, requireRole("admin"), async (req, res, next) => {
  try {
    const objectId = toObjectId(req.params.id);
    if (!objectId) throw badRequest("Invalid service id");

    const result = await services().deleteOne({ _id: objectId });
    if (!result.deletedCount) throw notFound("Service not found");

    res.json({ success: true, message: "Service deleted successfully" });
  } catch (error) {
    next(error);
  }
});

export default router;
