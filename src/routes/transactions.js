import { Router } from "express";
import { getCollection, toIdString, toObjectId } from "../db/mongo.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { notFound } from "../utils/ApiError.js";
import { serializeService, serializeUser } from "../utils/serializers.js";

const router = Router();
const transactions = () => getCollection("transactions");
const appointments = () => getCollection("appointments");
const services = () => getCollection("services");
const users = () => getCollection("user");

async function populateTransactions(docs) {
  if (!docs.length) return [];

  const appointmentIds = [
    ...new Set(docs.map((doc) => toIdString(doc.appointmentId)).filter(Boolean)),
  ]
    .map((id) => toObjectId(id))
    .filter(Boolean);
  const customerIds = [
    ...new Set(docs.map((doc) => toIdString(doc.customerId)).filter(Boolean)),
  ]
    .map((id) => toObjectId(id))
    .filter(Boolean);

  const [appointmentDocs, customerDocs] = await Promise.all([
    appointments().find({ _id: { $in: appointmentIds } }).toArray(),
    users()
      .find({ _id: { $in: customerIds } })
      .project({ name: 1, email: 1, image: 1, phone: 1 })
      .toArray(),
  ]);

  const serviceIds = [
    ...new Set(appointmentDocs.map((doc) => toIdString(doc.serviceId)).filter(Boolean)),
  ]
    .map((id) => toObjectId(id))
    .filter(Boolean);
  const serviceDocs = await services().find({ _id: { $in: serviceIds } }).toArray();

  const appointmentMap = new Map(
    appointmentDocs.map((doc) => [toIdString(doc._id), doc])
  );
  const customerMap = new Map(
    customerDocs.map((doc) => [toIdString(doc._id), doc])
  );
  const serviceMap = new Map(
    serviceDocs.map((doc) => [toIdString(doc._id), doc])
  );

  return docs.map((doc) => {
    const appointment = appointmentMap.get(toIdString(doc.appointmentId));
    const customer = customerMap.get(toIdString(doc.customerId));
    const service = appointment
      ? serviceMap.get(toIdString(appointment.serviceId))
      : null;

    return {
      id: toIdString(doc._id),
      appointmentId: toIdString(doc.appointmentId),
      customerId: toIdString(doc.customerId),
      amount: doc.amount,
      currency: doc.currency,
      stripeSessionId: doc.stripeSessionId,
      status: doc.status,
      createdAt: doc.createdAt,
      customer: customer
        ? serializeUser(customer)
        : { id: toIdString(doc.customerId), name: "Deleted customer", email: "" },
      appointment: appointment
        ? {
            id: toIdString(appointment._id),
            appointmentDate: appointment.appointmentDate,
            timeSlot: appointment.timeSlot,
            status: appointment.status,
          }
        : null,
      service: service
        ? serializeService(service)
        : appointment
          ? {
              id: toIdString(appointment.serviceId),
              serviceName: "Service no longer available",
              category: "Removed",
              price: appointment.servicePrice,
            }
          : null,
    };
  });
}

// GET /api/transactions  (admin)
router.get("/", authenticate, requireRole("admin"), async (req, res, next) => {
  try {
    const docs = await transactions().find({}).sort({ createdAt: -1 }).toArray();
    const data = await populateTransactions(docs);
    res.json({ success: true, data, total: data.length });
  } catch (error) {
    next(error);
  }
});

// GET /api/transactions/my  (customer)
router.get("/my", authenticate, requireRole("customer"), async (req, res, next) => {
  try {
    const docs = await transactions()
      .find({ customerId: toObjectId(req.authUserId) })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, data: await populateTransactions(docs) });
  } catch (error) {
    next(error);
  }
});

// GET /api/transactions/:id  (admin or owner)
router.get("/:id", authenticate, async (req, res, next) => {
  try {
    const objectId = toObjectId(req.params.id);
    if (!objectId) throw notFound("Transaction not found");

    const doc = await transactions().findOne({ _id: objectId });
    if (!doc) throw notFound("Transaction not found");
    if (
      req.authUser.role !== "admin" &&
      toIdString(doc.customerId) !== req.authUserId
    ) {
      throw notFound("Transaction not found");
    }

    const [data] = await populateTransactions([doc]);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

export default router;
