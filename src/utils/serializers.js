import { toIdString } from "../db/mongo.js";

export function serializeUser(doc) {
  if (!doc) return null;
  return {
    id: toIdString(doc._id ?? doc.id),
    name: doc.name || "",
    email: doc.email || "",
    image: doc.image || "",
    role: doc.role || "customer",
    isBlocked: Boolean(doc.isBlocked),
    phone: doc.phone || "",
    createdAt: doc.createdAt,
  };
}

export function serializeService(doc) {
  if (!doc) return null;
  return {
    id: toIdString(doc._id ?? doc.id),
    serviceName: doc.serviceName,
    category: doc.category,
    description: doc.description,
    price: doc.price,
    duration: doc.duration,
    image: doc.image,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
