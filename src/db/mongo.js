import { MongoClient, ObjectId } from "mongodb";
import { env } from "../config/env.js";

let client = null;
let database = null;

export async function connectToMongoDB() {
  if (database) return database;

  client = new MongoClient(env.dbUri);
  await client.connect();
  database = client.db(env.dbName);
  console.log(`Connected to MongoDB database "${env.dbName}"`);
  return database;
}

export function getDb() {
  if (!database) {
    throw new Error("Database is not connected yet");
  }
  return database;
}

export function getCollection(name) {
  return getDb().collection(name);
}

export function toObjectId(value) {
  if (value instanceof ObjectId) return value;
  if (typeof value === "string" && /^[a-f0-9]{24}$/i.test(value)) {
    return new ObjectId(value);
  }
  return null;
}

export function toIdString(value) {
  if (!value) return undefined;
  if (value instanceof ObjectId) return value.toString();
  return String(value);
}

export async function ensureIndexes() {
  await Promise.all([
    getCollection("services").createIndex({ status: 1, category: 1 }),
    getCollection("services").createIndex({ serviceName: "text" }),
    getCollection("appointments").createIndex({ customerId: 1, createdAt: -1 }),
    getCollection("appointments").createIndex({ appointmentDate: 1, timeSlot: 1, status: 1 }),
    getCollection("appointments").createIndex(
      { appointmentDate: 1, timeSlot: 1 },
      {
        unique: true,
        partialFilterExpression: { status: { $in: ["pending", "confirmed"] } },
      }
    ),
    getCollection("transactions").createIndex({ appointmentId: 1 }),
    getCollection("messages").createIndex({ createdAt: -1 }),
    getCollection("user").createIndex({ role: 1, createdAt: -1 }),
    getCollection("transactions").createIndex(
      { stripeSessionId: 1 },
      { unique: true, sparse: true }
    ),
  ]);
  console.log("Database indexes are ready");
}
