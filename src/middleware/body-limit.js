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
    const body = c.req.raw.clone().body;
    if (!body) {
      c.set("payloadBytes", 0);
      c.set("requestBodyBytes", new Uint8Array());
      return null;
    }

    const reader = body.getReader();
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > policy.bodyLimitBytes) {
        await reader.cancel();
        c.set("payloadBytes", totalBytes);
        return errorResponse(
          c,
          413,
          "payload_too_large",
          `Request body exceeds the ${policy.bodyLimitBytes}-byte limit`,
        );
      }
      chunks.push(chunk);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    c.set("payloadBytes", bytes.byteLength);
    c.set("requestBodyBytes", bytes);
  } catch {
    return errorResponse(c, 400, "invalid_body", "Request body could not be read");
  }

  return null;
}
