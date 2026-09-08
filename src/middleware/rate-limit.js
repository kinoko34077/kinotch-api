function errorResponse(c, status, code, message) {
  const requestId = c.get("requestId");
  return c.json({
    error: code,
    message,
    ...(requestId ? { requestId } : {}),
  }, status);
}

function getClientKey(c) {
  const connectingIp = c.req.header("cf-connecting-ip");
  if (connectingIp) return connectingIp;
  const forwarded = c.req.header("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return forwarded || "anonymous";
}

export async function enforceRateLimit(c, policy) {
  const config = policy.rateLimit;
  if (!config) return null;

  const limiter = c.env?.[config.binding];
  if (!limiter || typeof limiter.limit !== "function") {
    c.set("rateLimitResult", "unconfigured");
    return errorResponse(c, 503, "rate_limiter_unavailable", "Rate limiting is temporarily unavailable");
  }

  const key = `${policy.id}:${getClientKey(c)}`;
  try {
    const result = await limiter.limit({ key });
    if (result?.success !== true) {
      c.set("rateLimitResult", "blocked");
      c.header("RateLimit-Limit", String(config.limit));
      c.header("RateLimit-Policy", `${config.limit};w=${config.period}`);
      c.header("Retry-After", String(config.period));
      return errorResponse(c, 429, "rate_limited", "Too many requests");
    }
    c.set("rateLimitResult", "allowed");
  } catch {
    c.set("rateLimitResult", "error");
    return errorResponse(c, 503, "rate_limiter_unavailable", "Rate limiting is temporarily unavailable");
  }

  return null;
}
