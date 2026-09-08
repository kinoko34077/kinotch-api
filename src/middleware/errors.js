export class UpstreamRequestError extends Error {
  constructor(message, { status = 502, code = "upstream_failure" } = {}) {
    super(message);
    this.name = "UpstreamRequestError";
    this.status = status;
    this.code = code;
  }
}

export function notFoundMiddleware(c) {
  return c.json({ error: "Not found" }, 404);
}

export function errorMiddleware(error, c) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : 500;
  const code = typeof error?.code === "string"
    ? error.code
    : status === 500 ? "gateway_error" : "upstream_failure";
  console.error(JSON.stringify({
    event: "gateway_error",
    requestId: c.get("requestId") ?? null,
    status,
    code,
    errorType: error?.name ?? "Error",
  }));
  return c.json({
    error: code,
    message: status >= 500 ? "Gateway request failed" : "Request failed",
    ...(c.get("requestId") ? { requestId: c.get("requestId") } : {}),
  }, status);
}
