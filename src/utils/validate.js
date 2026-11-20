import { badRequest } from "./ApiError.js";

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function requireString(value, field, { min = 1, max = 5000 } = {}) {
  if (typeof value !== "string" || value.trim().length < min) {
    throw badRequest(`${field} must be at least ${min} characters long`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw badRequest(`${field} must be at most ${max} characters long`);
  }
  return trimmed;
}

export function optionalString(value, field, { max = 5000 } = {}) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.trim().length > max) {
    throw badRequest(`${field} must be a valid text up to ${max} characters`);
  }
  return value.trim();
}

export function requirePositiveNumber(value, field, { max = 1_000_000, integer = false } = {}) {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || Number.isNaN(number) || number <= 0) {
    throw badRequest(`${field} must be a positive number`);
  }
  if (integer && !Number.isInteger(number)) {
    throw badRequest(`${field} must be a whole number`);
  }
  if (number > max) {
    throw badRequest(`${field} is too large`);
  }
  return number;
}

export function requireEnum(value, field, allowed, fallback) {
  if ((value === undefined || value === null || value === "") && fallback) {
    return fallback;
  }
  if (!allowed.includes(value)) {
    throw badRequest(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

export function requireUrl(value, field) {
  const url = requireString(value, field, { min: 5, max: 1000 });
  if (!/^https?:\/\/.+/i.test(url)) {
    throw badRequest(`${field} must be a valid http(s) URL`);
  }
  return url;
}

export function requireBoolean(value, field) {
  if (typeof value !== "boolean") {
    throw badRequest(`${field} must be a boolean`);
  }
  return value;
}

export function requireDateString(value, field = "Date") {
  const date = requireString(value, field, { min: 10, max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw badRequest(`${field} must be a valid date (YYYY-MM-DD)`);
  }
  return date;
}

export function todayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
