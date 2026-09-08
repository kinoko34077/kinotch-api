export async function requestMetricsMiddleware(c, next) {
  const startedAt = Date.now();
  try {
    await next();
  } finally {
    if (c.env?.ENABLE_REQUEST_LOGS !== "true") return;
    console.log(JSON.stringify({
      event: "gateway_request",
      requestId: c.get("requestId") ?? null,
      route: c.req.path,
      method: c.req.method,
      status: c.res?.status ?? 500,
      durationMs: Date.now() - startedAt,
      payloadBytes: c.get("payloadBytes") ?? 0,
      rateLimitResult: c.get("rateLimitResult") ?? "not_applicable",
      profileCount: c.get("profileCount") ?? null,
      batchCount: c.get("batchCount") ?? null,
    }));
  }
}

