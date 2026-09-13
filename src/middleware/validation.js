import {
  COMPRESSION_PROFILE,
  countUnicodeCodePoints,
  MAX_GEMINI_INPUT_CODE_POINTS,
  MAX_COMPRESSION_TEXT_LENGTH,
} from "../semantic-compression/contract.js";

function errorResponse(c, status, code, message, details) {
  const requestId = c.get("requestId");
  return c.json({
    error: code,
    message,
    ...(details ? { details } : {}),
    ...(requestId ? { requestId } : {}),
  }, status);
}

function invalid(code, message, details) {
  return { status: 400, code, message, details };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateText(value, field = "text") {
  if (typeof value !== "string") return invalid("invalid_text", `${field} must be a string`);
  if (value.length > 100_000) {
    return invalid("invalid_text", `${field} exceeds 100000 characters`);
  }
  return null;
}

function validateProfile(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    return invalid("invalid_profile", "profile must be a non-empty array with at most 16 entries");
  }
  if (value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    return invalid("invalid_profile", "profile entries must be non-empty strings");
  }
  return null;
}

export function validateTransformBody(body) {
  if (!isPlainObject(body)) return invalid("invalid_json", "Request body must be a JSON object");
  return validateText(body.text) ?? validateProfile(body.profile);
}

export function validateBatchBody(body) {
  if (!isPlainObject(body)) return invalid("invalid_json", "Request body must be a JSON object");
  if (!Array.isArray(body.texts) || body.texts.length === 0 || body.texts.length > 256) {
    return invalid("invalid_texts", "texts must be a non-empty array with at most 256 items");
  }

  let totalLength = 0;
  for (const text of body.texts) {
    const error = validateText(text, "texts item");
    if (error) return invalid("invalid_texts", error.message);
    totalLength += text.length;
    if (totalLength > 200_000) {
      return invalid("invalid_texts", "texts exceed 200000 characters in total");
    }
  }

  return validateProfile(body.profile);
}

export function validateRubyBody(body) {
  if (!isPlainObject(body)) return invalid("invalid_json", "Request body must be a JSON object");
  const textError = validateText(body.text);
  if (textError) return textError;
  if (body.markers === undefined) return null;
  if (!isPlainObject(body.markers)) {
    return invalid("invalid_markers", "markers must be an object");
  }
  for (const key of ["open", "close"]) {
    if (body.markers[key] !== undefined &&
      (typeof body.markers[key] !== "string" || body.markers[key].trim() === "" || body.markers[key].length > 32)) {
      return invalid("invalid_markers", "markers.open and markers.close must be non-empty strings of at most 32 characters");
    }
  }
  return null;
}

const COMPRESSION_REQUEST_FIELDS = new Set(["text", "profile"]);

export function validateCompressionBody(body) {
  if (!isPlainObject(body)) return invalid("invalid_body", "Request body must be a JSON object");

  const hasUnsupportedField = Object.keys(body).some((key) => !COMPRESSION_REQUEST_FIELDS.has(key));
  if (hasUnsupportedField) return invalid("invalid_body", "Request body contains unsupported fields");
  if (typeof body.text !== "string") return invalid("invalid_body", "text must be a string");
  if (body.text.length === 0) return invalid("empty_text", "text must not be empty");
  if (body.profile !== COMPRESSION_PROFILE) return invalid("invalid_profile", "profile is not supported");
  if (countUnicodeCodePoints(body.text) > MAX_COMPRESSION_TEXT_LENGTH) {
    return { status: 413, code: "payload_too_large", message: "text exceeds the maximum length" };
  }
  if (countUnicodeCodePoints(body.text) > MAX_GEMINI_INPUT_CODE_POINTS) {
    return { status: 413, code: "provider_context_limit", message: "text exceeds the provider context safety limit" };
  }
  return null;
}

function validateCoordinate(value, name, minimum, maximum) {
  if (value === undefined || value === "") {
    return invalid("invalid_query", `Missing '${name}'`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    return invalid("invalid_query", `${name} must be a number from ${minimum} to ${maximum}`);
  }
  return null;
}

export function validateCoordinatesQuery(query) {
  return validateCoordinate(query.lat, "lat", -90, 90) ??
    validateCoordinate(query.lon, "lon", -180, 180);
}

export function validateDateQuery(query) {
  const value = query.date;
  if (value === undefined || value === "") return invalid("invalid_query", "Missing 'date'");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return invalid("invalid_query", "date must use YYYY-MM-DD");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return invalid("invalid_query", "date must be a real calendar date");
  }
  return null;
}

export async function validateRequest(c, policy) {
  if (typeof policy.validateQuery === "function") {
    const queryError = policy.validateQuery(c.req.query());
    if (queryError) return errorResponse(c, queryError.status, queryError.code, queryError.message, queryError.details);
  }

  if (policy.bodyType !== "json") return null;
  const contentType = c.req.header("content-type") ?? "";
  if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType.trim())) {
    return errorResponse(c, 415, "unsupported_media_type", "Content-Type must be application/json");
  }

  let body;
  try {
    const bytes = c.get("requestBodyBytes") ?? await c.req.raw.clone().arrayBuffer();
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return errorResponse(c, 400, "invalid_json", "Request body must be valid JSON");
  }

  const bodyError = policy.validateBody?.(body);
  if (bodyError) return errorResponse(c, bodyError.status, bodyError.code, bodyError.message, bodyError.details);

  c.set("validatedBody", body);
  if (Array.isArray(body?.profile)) c.set("profileCount", body.profile.length);
  if (Array.isArray(body?.texts)) c.set("batchCount", body.texts.length);
  return null;
}
