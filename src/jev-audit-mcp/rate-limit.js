import { JevAuditMcpError } from "./upstream.js";

export const JEV_AUDIT_MCP_RATE_LIMIT = Object.freeze({
  binding: "JEV_AUDIT_MCP_RATE_LIMITER",
  keyPrefix: "jev-audit-mcp",
  limit: 5,
  period: 60,
});

function getClientKey(request) {
  const connectingIp = request?.headers?.get("cf-connecting-ip")?.trim();
  if (connectingIp) return connectingIp;
  return "unknown";
}

function getRateLimitKey(request, actorKey) {
  if (typeof actorKey === "string" && /^[a-f0-9]{64}$/i.test(actorKey)) {
    return `${JEV_AUDIT_MCP_RATE_LIMIT.keyPrefix}:actor:${actorKey.toLowerCase()}`;
  }
  return `${JEV_AUDIT_MCP_RATE_LIMIT.keyPrefix}:${getClientKey(request)}`;
}

export async function enforceJevAuditMcpRateLimit(env, request) {
  const limiter = env?.[JEV_AUDIT_MCP_RATE_LIMIT.binding];
  if (!limiter || typeof limiter.limit !== "function") {
    return new JevAuditMcpError("rate_limiter_unavailable", 503);
  }
  try {
    const result = await limiter.limit({ key: getRateLimitKey(request, env?.MCP_ACCESS_ACTOR_KEY) });
    if (result?.success !== true) return new JevAuditMcpError("rate_limited", 429);
  } catch {
    return new JevAuditMcpError("rate_limiter_unavailable", 503);
  }
  return null;
}
