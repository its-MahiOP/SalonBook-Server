import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env.js";
import { getCollection, toObjectId, toIdString } from "../db/mongo.js";
import { forbidden, unauthorized } from "../utils/ApiError.js";

let jwks = null;

function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(env.jwksUrl));
  }
  return jwks;
}

function readToken(req) {
  const header = req.headers.authorization || "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function serializeUser(doc) {
  return {
    id: toIdString(doc._id),
    name: doc.name,
    email: doc.email,
    image: doc.image || "",
    role: doc.role || "customer",
    isBlocked: Boolean(doc.isBlocked),
    phone: doc.phone || "",
    createdAt: doc.createdAt,
  };
}

/**
 * Verifies the Better Auth JWT (signed with JWKS) and loads the fresh user
 * record from MongoDB so role and blocked status can never be tampered with.
 */
export async function authenticate(req, res, next) {
  try {
    const token = readToken(req);
    if (!token) {
      throw unauthorized("Please sign in to continue");
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(token, getJwks()));
    } catch {
      throw unauthorized("Your session has expired. Please sign in again.");
    }

    if (!payload?.sub) {
      throw unauthorized("Invalid authentication token");
    }

    let user = null;
    const objectId = toObjectId(payload.sub);
    if (objectId) {
      user = await getCollection("user").findOne({ _id: objectId });
    }
    if (!user) {
      user = await getCollection("user").findOne({ _id: payload.sub });
    }
    if (!user) {
      throw unauthorized("The account linked to this session no longer exists");
    }
    if (user.isBlocked) {
      throw forbidden(
        "Your account has been blocked by the administrator. Please contact the salon for help."
      );
    }

    req.authUser = serializeUser(user);
    req.authUserId = toIdString(user._id);
    next();
  } catch (error) {
    next(error);
  }
}

export function optionalAuthenticate(req, res, next) {
  if (!readToken(req)) return next();
  return authenticate(req, res, next);
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.authUser) {
      return next(unauthorized("Please sign in to continue"));
    }
    if (!roles.includes(req.authUser.role)) {
      return next(forbidden("You do not have access to this resource"));
    }
    return next();
  };
}

export const requireAdmin = [authenticate, requireRole("admin")];
export const requireCustomer = [authenticate, requireRole("customer")];
