import "dotenv/config";

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const authBaseUrl = (process.env.AUTH_JWKS_URL || "http://localhost:3000").replace(/\/+$/, "");
const jwksUrl = authBaseUrl.endsWith("/jwks")
  ? authBaseUrl
  : `${authBaseUrl}/api/auth/jwks`;

const clientUrls = (process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")
  .map((url) => url.trim().replace(/\/+$/, ""))
  .filter(Boolean);

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 5000,
  dbUri: process.env.DB_URI,
  dbName: process.env.DB_NAME || "SalonBook",
  authBaseUrl,
  jwksUrl,
  clientUrls,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "",
  currency: (process.env.STRIPE_CURRENCY || "usd").toLowerCase(),
};
