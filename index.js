import "dotenv/config";
import express from "express";
import cors from "cors";
import { env } from "./src/config/env.js";
import {
  connectToMongoDB,
  disconnectFromMongoDB,
  ensureIndexes,
  getDb,
} from "./src/db/mongo.js";
import { errorHandler, notFoundHandler } from "./src/middleware/error.js";
import { securityHeaders } from "./src/middleware/security.js";
import { requestLogger } from "./src/middleware/logger.js";
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

app.use(securityHeaders);
app.use(requestLogger);

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

app.get("/api/health", async (req, res) => {
  let database = "down";
  try {
    const mongo = getDb();
    await mongo.command({ ping: 1 });
    database = "up";
  } catch {
    database = "down";
  }

  const ok = database === "up";
  res.status(ok ? 200 : 503).json({
    success: ok,
    status: ok ? "ok" : "degraded",
    database,
    uptime: Math.round(process.uptime()),
    time: new Date().toISOString(),
  });
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

  const server = app.listen(env.port, () => {
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

  // Close the HTTP server and MongoDB connection cleanly on Ctrl+C or deploys.
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received, shutting down SalonBook API...`);

    const forceExit = setTimeout(() => {
      console.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close(async () => {
      try {
        await disconnectFromMongoDB();
        console.log("Database connection closed");
        process.exit(0);
      } catch (error) {
        console.error("Error while shutting down:", error);
        process.exit(1);
      }
    });
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((error) => {
  console.error("Failed to start SalonBook API:", error);
  process.exit(1);
});
