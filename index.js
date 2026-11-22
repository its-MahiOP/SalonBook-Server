import "dotenv/config";
import express from "express";
import cors from "cors";
import { env } from "./src/config/env.js";
import { connectToMongoDB, ensureIndexes } from "./src/db/mongo.js";
import { errorHandler, notFoundHandler } from "./src/middleware/error.js";
import servicesRouter from "./src/routes/services.js";
import appointmentsRouter from "./src/routes/appointments.js";
import usersRouter from "./src/routes/users.js";
import profileRouter from "./src/routes/profile.js";
import transactionsRouter from "./src/routes/transactions.js";
import statsRouter from "./src/routes/stats.js";
import contactRouter from "./src/routes/contact.js";
import paymentsRouter, { paymentsWebhookHandler } from "./src/routes/payments.js";

const app = express();
app.disable("x-powered-by");

app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server requests and configured client origins.
      if (!origin || env.clientUrls.includes(origin)) {
        return callback(null, true);
      }
      console.warn(`Blocked CORS request from origin: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
  })
);

// Stripe requires the raw request body, so this route is registered before
// express.json(). Payment status is only updated by this verified webhook.
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  paymentsWebhookHandler
);

app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to the SalonBook API",
    version: "1.0.0",
  });
});

app.get("/api/health", (req, res) => {
  res.json({ success: true, status: "ok", time: new Date().toISOString() });
});

app.use("/api/services", servicesRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/users", usersRouter);
app.use("/api/profile", profileRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/stats", statsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/contact", contactRouter);

app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  await connectToMongoDB();
  await ensureIndexes();

  app.listen(env.port, () => {
    console.log(`SalonBook API is running on http://localhost:${env.port}`);
    console.log(`Allowed client origins: ${env.clientUrls.join(", ")}`);
    console.log(`JWT verification uses: ${env.jwksUrl}`);

    if (!env.stripeSecretKey) {
      console.warn(
        "STRIPE_SECRET_KEY is empty — checkout will return 503 until Stripe test keys are added."
      );
    }
    if (env.stripeSecretKey && !env.stripeWebhookSecret) {
      console.warn(
        "STRIPE_WEBHOOK_SECRET is missing — webhook events will be rejected, so appointments will never be marked as paid."
      );
    }
  });
}

start().catch((error) => {
  console.error("Failed to start SalonBook API:", error);
  process.exit(1);
});
