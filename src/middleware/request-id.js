const REQUEST_ID_HEADER = "X-Request-ID";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function createRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function requestIdMiddleware() {
  return async (c, next) => {
    const requestedId = c.req.header(REQUEST_ID_HEADER);
    const requestId = requestedId && REQUEST_ID_PATTERN.test(requestedId)
      ? requestedId
      : createRequestId();

    c.set("requestId", requestId);
    c.header(REQUEST_ID_HEADER, requestId);
    await next();
    c.header(REQUEST_ID_HEADER, requestId);
  };
}

