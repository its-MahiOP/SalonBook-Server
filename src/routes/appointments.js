import { Router } from "express";
import { getCollection, toIdString, toObjectId } from "../db/mongo.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { APPOINTMENT_STATUS, TIME_SLOTS } from "../utils/constants.js";
import { badRequest, conflict, forbidden, notFound } from "../utils/ApiError.js";
import { populateAppointments } from "../utils/populate.js";
import {
  optionalString,
  requireDateString,
  requireEnum,
  requireString,
  todayString,
} from "../utils/validate.js";

const router = Router();
const appointments = () => getCollection("appointments");
const services = () => getCollection("services");

// GET /api/appointments/available-slots?date=YYYY-MM-DD
router.get("/available-slots", async (req, res, next) => {
  try {
    const date = requireDateString(req.query.date, "Date");
    const docs = await appointments()
      .find({
        appointmentDate: date,
        status: { $in: ["pending", "confirmed"] },
      })
      .project({ timeSlot: 1 })
      .toArray();

    const taken = new Set(docs.map((doc) => doc.timeSlot));
    res.json({
      success: true,
      data: TIME_SLOTS.map((slot) => ({
        time: slot,
        available: !taken.has(slot),
      })),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/appointments/my  (customer)
router.get("/my", authenticate, requireRole("customer"), async (req, res, next) => {
  try {
    const docs = await appointments()
      .find({ customerId: toObjectId(req.authUserId) })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, data: await populateAppointments(docs) });
  } catch (error) {
    next(error);
  }
});

// GET /api/appointments  (admin)
router.get("/", authenticate, requireRole("admin"), async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const filter = {};
    if (status && APPOINTMENT_STATUS.includes(status)) {
      filter.status = status;
    }

    const docs = await appointments().find(filter).sort({ createdAt: -1 }).toArray();
    let data = await populateAppointments(docs);

    if (search && String(search).trim()) {
      const query = String(search).trim().toLowerCase();
      data = data.filter(
        (item) =>
          item.customer.name.toLowerCase().includes(query) ||
          item.customer.email.toLowerCase().includes(query) ||
          item.service.serviceName.toLowerCase().includes(query)
      );
    }

    res.json({ success: true, data, total: data.length });
  } catch (error) {
    next(error);
  }
});

// GET /api/appointments/:id
router.get("/:id", authenticate, async (req, res, next) => {
  try {
    const objectId = toObjectId(req.params.id);
    if (!objectId) throw badRequest("Invalid appointment id");

    const doc = await appointments().findOne({ _id: objectId });
    if (!doc) throw notFound("Appointment not found");

    const ownerId = toIdString(doc.customerId);
    if (req.authUser.role !== "admin" && ownerId !== req.authUserId) {
      throw forbidden("You can only view your own appointments");
    }

    const [data] = await populateAppointments([doc]);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// POST /api/appointments  (customer)
router.post("/", authenticate, requireRole("customer"), async (req, res, next) => {
  try {
    const { serviceId, appointmentDate, timeSlot, message } = req.body || {};

    if (!serviceId || !toObjectId(serviceId)) {
      throw badRequest("A valid service is required");
    }
    const date = requireDateString(appointmentDate, "Appointment date");
    if (date < todayString()) {
      throw badRequest("Appointment date cannot be in the past");
    }
    const slot = requireEnum(timeSlot, "Time slot", TIME_SLOTS);
    const note = optionalString(message, "Message", { max: 500 });

    const service = await services().findOne({ _id: toObjectId(serviceId) });
    if (!service) throw notFound("Service not found");
    if (service.status !== "active") {
      throw badRequest("This service is not available for booking right now");
    }

    const existing = await appointments().findOne({
      appointmentDate: date,
      timeSlot: slot,
      status: { $in: ["pending", "confirmed"] },
    });
    if (existing) {
      throw conflict("That time slot is already booked. Please choose another slot.");
    }

    const now = new Date();
    const doc = {
      serviceId: service._id,
      customerId: toObjectId(req.authUserId),
      appointmentDate: date,
      timeSlot: slot,
      message: note,
      servicePrice: service.price,
      paymentStatus: "unpaid",
      status: "pending",
      createdAt: now,
    };

    try {
      const result = await appointments().insertOne(doc);
      const [data] = await populateAppointments([
        { ...doc, _id: result.insertedId },
      ]);
      res.status(201).json({
        success: true,
        message: "Appointment request submitted. We will confirm it shortly.",
        data,
      });
    } catch (error) {
      if (error?.code === 11000) {
        throw conflict("That time slot is already booked. Please choose another slot.");
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

// PATCH /api/appointments/:id/cancel  (customer cancels own pending appointment)
router.patch(
  "/:id/cancel",
  authenticate,
  requireRole("customer"),
  async (req, res, next) => {
    try {
      const objectId = toObjectId(req.params.id);
      if (!objectId) throw badRequest("Invalid appointment id");

      const doc = await appointments().findOne({ _id: objectId });
      if (!doc) throw notFound("Appointment not found");
      if (toIdString(doc.customerId) !== req.authUserId) {
        throw forbidden("You can only cancel your own appointments");
      }
      if (doc.status !== "pending") {
        throw badRequest("Only pending appointment requests can be cancelled");
      }

      await appointments().updateOne(
        { _id: objectId },
        { $set: { status: "cancelled", cancelledAt: new Date() } }
      );

      const [data] = await populateAppointments([
        { ...doc, status: "cancelled" },
      ]);
      res.json({ success: true, message: "Appointment cancelled", data });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/appointments/:id/status  (admin confirms or cancels)
router.patch(
  "/:id/status",
  authenticate,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const objectId = toObjectId(req.params.id);
      if (!objectId) throw badRequest("Invalid appointment id");

      const status = requireEnum(req.body?.status, "Status", [
        "confirmed",
        "cancelled",
      ]);

      const doc = await appointments().findOne({ _id: objectId });
      if (!doc) throw notFound("Appointment not found");

      if (status === "confirmed" && doc.status !== "pending") {
        throw badRequest("Only pending appointments can be confirmed");
      }
      if (status === "cancelled" && doc.status === "cancelled") {
        throw badRequest("This appointment is already cancelled");
      }
      if (status === doc.status) {
        throw badRequest(`Appointment is already ${status}`);
      }

      const update = {
        status,
        updatedAt: new Date(),
      };
      if (status === "confirmed") update.confirmedAt = new Date();
      if (status === "cancelled") update.cancelledAt = new Date();

      const updated = await appointments().findOneAndUpdate(
        { _id: objectId },
        { $set: update },
        { returnDocument: "after" }
      );

      const [data] = await populateAppointments([updated]);
      res.json({
        success: true,
        message: `Appointment ${status === "confirmed" ? "confirmed" : "cancelled"} successfully`,
        data,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
