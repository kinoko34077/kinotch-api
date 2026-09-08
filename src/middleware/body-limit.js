function errorResponse(c, status, code, message) {
  const requestId = c.get("requestId");
  return c.json({
    error: code,
    message,
    ...(requestId ? { requestId } : {}),
  }, status);
}

export async function enforceBodyLimit(c, policy) {
  if (!Number.isFinite(policy.bodyLimitBytes) || policy.bodyLimitBytes < 0) {
    return null;
  }
  if (!["POST", "PUT", "PATCH"].includes(c.req.method)) {
    return null;
  }

  const rawContentLength = c.req.header("content-length");
  if (rawContentLength !== undefined && /^\d+$/.test(rawContentLength.trim())) {
    const contentLength = Number(rawContentLength);
    if (!Number.isSafeInteger(contentLength) || contentLength > policy.bodyLimitBytes) {
      return errorResponse(
        c,
        413,
        "payload_too_large",
        `Request body exceeds the ${policy.bodyLimitBytes}-byte limit`,
      );
    }
    c.set("payloadBytes", contentLength);
    return null;
  }

  try {
    const bytes = await c.req.raw.clone().arrayBuffer();
    c.set("payloadBytes", bytes.byteLength);
    if (bytes.byteLength > policy.bodyLimitBytes) {
      return errorResponse(
        c,
        413,
        "payload_too_large",
        `Request body exceeds the ${policy.bodyLimitBytes}-byte limit`,
      );
    }
  } catch {
    return errorResponse(c, 400, "invalid_body", "Request body could not be read");
  }

  return null;
}

