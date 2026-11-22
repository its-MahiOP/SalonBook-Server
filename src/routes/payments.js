import { Router } from "express";
import Stripe from "stripe";
import { env } from "../config/env.js";
import { getCollection, toObjectId } from "../db/mongo.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { ApiError, badRequest, conflict, notFound } from "../utils/ApiError.js";

const router = Router();
const appointments = () => getCollection("appointments");
const transactions = () => getCollection("transactions");

let stripeClient = null;

function getStripe() {
  if (!env.stripeSecretKey) {
    throw new ApiError(
      503,
      "Online payments are not configured yet. Please contact the salon."
    );
  }
  if (!stripeClient) {
    stripeClient = new Stripe(env.stripeSecretKey);
  }
  return stripeClient;
}

// POST /api/payments/checkout - create a Stripe Checkout session
router.post(
  "/checkout",
  authenticate,
  requireRole("customer"),
  async (req, res, next) => {
    try {
      const appointmentId = toObjectId(req.body?.appointmentId);
      if (!appointmentId) throw badRequest("A valid appointment id is required");

      const appointment = await appointments().findOne({
        _id: appointmentId,
        customerId: toObjectId(req.authUserId),
      });
      if (!appointment) throw notFound("Appointment not found");
      if (appointment.status !== "confirmed") {
        throw badRequest("Only confirmed appointments can be paid for");
      }
      if (appointment.paymentStatus === "paid") {
        throw conflict("This appointment has already been paid");
      }

      const alreadyPaid = await transactions().findOne({
        appointmentId,
        status: "paid",
      });
      if (alreadyPaid) throw conflict("This appointment has already been paid");

      const service = await getCollection("services").findOne({
        _id: appointment.serviceId,
      });
      if (!service) throw notFound("The service for this appointment is unavailable");

      const stripe = getStripe();
      const clientUrl = env.clientUrls[0];
      const amount = Math.round(Number(appointment.servicePrice) * 100);
      if (!Number.isFinite(amount) || amount < 50) {
        throw badRequest("This appointment amount cannot be charged online");
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: req.authUser.email,
        client_reference_id: String(appointmentId),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: env.currency,
              unit_amount: amount,
              product_data: {
                name: service.serviceName,
                description: `Salon appointment on ${appointment.appointmentDate} at ${appointment.timeSlot}`,
              },
            },
          },
        ],
        metadata: {
          appointmentId: String(appointmentId),
          customerId: req.authUserId,
          serviceId: String(appointment.serviceId),
        },
        success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl}/payment/cancel?appointment_id=${appointmentId}`,
      });

      res.json({
        success: true,
        data: { url: session.url, sessionId: session.id },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/payments/session/:sessionId - read-only payment status for success page
router.get(
  "/session/:sessionId",
  authenticate,
  async (req, res, next) => {
    try {
      const transaction = await transactions().findOne({
        stripeSessionId: req.params.sessionId,
      });

      if (!transaction) {
        return res.json({
          success: true,
          data: { paid: false, pending: true, transaction: null },
        });
      }

      const isOwner = String(transaction.customerId) === req.authUserId;
      if (!isOwner && req.authUser.role !== "admin") {
        throw notFound("Payment not found");
      }

      res.json({
        success: true,
        data: {
          paid: transaction.status === "paid",
          pending: false,
          transaction: {
            id: String(transaction._id),
            amount: transaction.amount,
            currency: transaction.currency,
            status: transaction.status,
            stripeSessionId: transaction.stripeSessionId,
            createdAt: transaction.createdAt,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/payments/status - lets the UI know if Stripe is configured
router.get("/status", (req, res) => {
  res.json({
    success: true,
    data: {
      configured: Boolean(env.stripeSecretKey),
      webhookConfigured: Boolean(env.stripeWebhookSecret),
      publishableKeyConfigured: Boolean(env.stripePublishableKey),
    },
  });
});

async function recordSuccessfulPayment(session) {
  const appointmentId = toObjectId(
    session.metadata?.appointmentId || session.client_reference_id
  );
  if (!appointmentId) return;

  const appointment = await appointments().findOne({ _id: appointmentId });
  if (!appointment) return;

  const existing = await transactions().findOne({
    stripeSessionId: session.id,
  });

  if (!existing) {
    try {
      await transactions().insertOne({
        appointmentId,
        customerId: appointment.customerId,
        amount: Number(session.amount_total || 0) / 100,
        currency: String(session.currency || env.currency).toUpperCase(),
        stripeSessionId: session.id,
        status: "paid",
        createdAt: new Date(),
      });
    } catch (error) {
      // A duplicate webhook delivery is safe to ignore.
      if (error?.code !== 11000) throw error;
    }
  }

  await appointments().updateOne(
    { _id: appointmentId },
    { $set: { paymentStatus: "paid", paidAt: new Date(), updatedAt: new Date() } }
  );
}

async function recordFailedPayment(session) {
  const appointmentId = toObjectId(
    session.metadata?.appointmentId || session.client_reference_id
  );
  if (!appointmentId) return;

  const existing = await transactions().findOne({
    stripeSessionId: session.id,
  });
  if (existing) return;

  const appointment = await appointments().findOne({ _id: appointmentId });
  if (!appointment) return;

  await transactions().insertOne({
    appointmentId,
    customerId: appointment.customerId,
    amount: Number(session.amount_total || 0) / 100,
    currency: String(session.currency || env.currency).toUpperCase(),
    stripeSessionId: session.id,
    status: "failed",
    createdAt: new Date(),
  });
}

/**
 * Stripe webhook. Mounted with express.raw() before the JSON body parser.
 * Payment status is only ever marked paid from a verified webhook event.
 */
export async function paymentsWebhookHandler(req, res) {
  if (!env.stripeSecretKey) {
    return res.status(503).json({
      success: false,
      message: "Stripe is not configured (STRIPE_SECRET_KEY missing)",
    });
  }
  if (!env.stripeWebhookSecret) {
    // Never trust an unsigned payload: payment status only changes on a
    // verified webhook, so an unconfigured secret must reject the event.
    return res.status(503).json({
      success: false,
      message:
        "Stripe webhooks are not configured (STRIPE_WEBHOOK_SECRET missing). " +
        "Add the signing secret from the Stripe dashboard to accept payments.",
    });
  }

  const signature = req.headers["stripe-signature"];
  if (!signature) {
    return res.status(400).json({ success: false, message: "Missing Stripe signature" });
  }

  let event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      env.stripeWebhookSecret
    );
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error.message);
    return res
      .status(400)
      .json({ success: false, message: "Invalid Stripe webhook signature" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        if (event.data.object.payment_status === "paid") {
          await recordSuccessfulPayment(event.data.object);
        }
        break;
      case "checkout.session.async_payment_succeeded":
        await recordSuccessfulPayment(event.data.object);
        break;
      case "checkout.session.async_payment_failed":
        await recordFailedPayment(event.data.object);
        break;
      default:
        break;
    }

    return res.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed:", error);
    return res
      .status(500)
      .json({ success: false, message: "Webhook processing failed" });
  }
}

export default router;
