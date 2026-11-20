import { Router } from "express";
import { getCollection, toObjectId } from "../db/mongo.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { populateAppointments } from "../utils/populate.js";

const router = Router();
const appointments = () => getCollection("appointments");
const services = () => getCollection("services");
const users = () => getCollection("user");
const transactions = () => getCollection("transactions");

function countByStatus(docs) {
  return docs.reduce(
    (acc, doc) => {
      acc.total += 1;
      if (doc.status === "pending") acc.pending += 1;
      if (doc.status === "confirmed") acc.confirmed += 1;
      if (doc.status === "cancelled") acc.cancelled += 1;
      return acc;
    },
    { total: 0, pending: 0, confirmed: 0, cancelled: 0 }
  );
}

// GET /api/stats/customer
router.get(
  "/customer",
  authenticate,
  requireRole("customer"),
  async (req, res, next) => {
    try {
      const customerId = toObjectId(req.authUserId);
      const docs = await appointments().find({ customerId }).toArray();
      const counts = countByStatus(docs);

      const paidTransactions = await transactions()
        .find({ customerId, status: "paid" })
        .toArray();
      const totalSpent = paidTransactions.reduce(
        (sum, tx) => sum + Number(tx.amount || 0),
        0
      );

      const upcoming = docs
        .filter(
          (doc) =>
            doc.status === "confirmed" &&
            doc.paymentStatus === "unpaid" &&
            doc.appointmentDate >= new Date().toISOString().slice(0, 10)
        )
        .sort((a, b) =>
          `${a.appointmentDate} ${a.timeSlot}`.localeCompare(
            `${b.appointmentDate} ${b.timeSlot}`
          )
        )
        .slice(0, 3);

      res.json({
        success: true,
        data: {
          ...counts,
          paidAppointments: docs.filter((doc) => doc.paymentStatus === "paid").length,
          totalSpent,
          upcoming: await populateAppointments(upcoming),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/stats/admin
router.get(
  "/admin",
  authenticate,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const [totalCustomers, activeServices, appointmentDocs, paidDocs, recent] =
        await Promise.all([
          users().countDocuments({ role: "customer" }),
          services().countDocuments({ status: "active" }),
          appointments().find({}).toArray(),
          transactions().find({ status: "paid" }).toArray(),
          appointments().find({}).sort({ createdAt: -1 }).limit(6).toArray(),
        ]);

      const counts = countByStatus(appointmentDocs);
      const totalRevenue = paidDocs.reduce(
        (sum, doc) => sum + Number(doc.amount || 0),
        0
      );

      res.json({
        success: true,
        data: {
          totalCustomers,
          activeServices,
          totalAppointments: counts.total,
          pending: counts.pending,
          confirmed: counts.confirmed,
          cancelled: counts.cancelled,
          totalSuccessfulPayments: paidDocs.length,
          totalRevenue,
          recentAppointments: await populateAppointments(recent),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
