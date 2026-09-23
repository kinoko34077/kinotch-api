import { CompressionMcpError } from "./upstream.js";

export const MCP_COMPRESSION_RATE_LIMIT = Object.freeze({
  binding: "MCP_RATE_LIMITER",
  keyPrefix: "semantic-compression-mcp",
  limit: 5,
  period: 60,
});

function getClientKey(request) {
  const connectingIp = request?.headers?.get("cf-connecting-ip")?.trim();
  if (connectingIp) return connectingIp;
  return "unknown";
}

export async function enforceMcpCompressionRateLimit(env, request) {
  const limiter = env?.[MCP_COMPRESSION_RATE_LIMIT.binding];
  if (!limiter || typeof limiter.limit !== "function") {
    return new CompressionMcpError("rate_limiter_unavailable", 503);
  }

  try {
    const result = await limiter.limit({
      key: `${MCP_COMPRESSION_RATE_LIMIT.keyPrefix}:${getClientKey(request)}`,
    });
    if (result?.success !== true) return new CompressionMcpError("rate_limited", 429);
  } catch {
    return new CompressionMcpError("rate_limiter_unavailable", 503);
  }
  return null;
}
