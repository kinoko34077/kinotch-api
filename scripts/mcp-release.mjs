export const MCP_RELEASE_WORKER_NAME = "semantic-compression-mcp";
export const MCP_RELEASE_CONFIG = "wrangler.semantic-compression-mcp.jsonc";
export const MCP_RELEASE_PROTOCOL = "streamable-http";
export const MCP_RELEASE_TOOL_VERSION = "compress_text/v1";

export function resolveMcpSmokeState(env = process.env) {
  const endpoint = typeof env.MCP_ENDPOINT === "string" && env.MCP_ENDPOINT.length > 0
    ? env.MCP_ENDPOINT
    : null;
  const hasAccessConfig = typeof env.TEAM_DOMAIN === "string"
    && env.TEAM_DOMAIN.length > 0
    && typeof env.POLICY_AUD === "string"
    && env.POLICY_AUD.length > 0;
  if (!endpoint || !hasAccessConfig) {
    return {
      status: "operator_required",
      reason: "Cloudflare Access setup and authenticated MCP smoke are required",
      endpoint,
    };
  }
  return {
    status: "operator_required",
    reason: "Authenticated OAuth smoke must be run by the operator",
    endpoint,
  };
}

export function buildMcpReleaseMetadata({
  versionId,
  previousVersionId,
  endpoint,
  smoke,
  recovery,
}) {
  return {
    mcpVersionId: versionId ?? null,
    previousMcpVersionId: previousVersionId ?? null,
    mcpEndpoint: endpoint ?? null,
    mcpProtocol: MCP_RELEASE_PROTOCOL,
    mcpToolVersion: MCP_RELEASE_TOOL_VERSION,
    mcpSmoke: smoke ?? null,
    mcpRecovery: recovery ?? null,
  };
}
