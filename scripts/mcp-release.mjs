export const MCP_RELEASE_WORKER_NAME = "semantic-compression-mcp";
export const MCP_RELEASE_CONFIG = "wrangler.semantic-compression-mcp.jsonc";
export const MCP_RELEASE_PROTOCOL = "streamable-http";
export const MCP_RELEASE_TOOL_VERSION = "compress_text/v1";

function requiredEnvValue(env, name) {
  const value = env?.[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`MCP production release requires ${name}`);
  }
  return value.trim();
}

export function resolveMcpWorkerVars(env = process.env) {
  return {
    TEAM_DOMAIN: requiredEnvValue(env, "TEAM_DOMAIN"),
    POLICY_AUD: requiredEnvValue(env, "POLICY_AUD"),
  };
}

export function createMcpDeployArgs({ env = process.env, dryRun = false } = {}) {
  const vars = resolveMcpWorkerVars(env);
  return [
    "wrangler",
    "deploy",
    "--config",
    MCP_RELEASE_CONFIG,
    "--var",
    `TEAM_DOMAIN:${vars.TEAM_DOMAIN}`,
    "--var",
    `POLICY_AUD:${vars.POLICY_AUD}`,
    ...(dryRun ? ["--dry-run"] : []),
  ];
}

export function resolveMcpSmokeInputs(env = process.env) {
  const endpoint = requiredEnvValue(env, "MCP_ENDPOINT");
  const accessCookie = requiredEnvValue(env, "MCP_SMOKE_ACCESS_COOKIE");
  return { endpoint, accessCookie };
}

export function resolveMcpSmokeState(env = process.env) {
  try {
    const { endpoint } = resolveMcpSmokeInputs(env);
    resolveMcpWorkerVars(env);
    return {
      status: "incomplete",
      reason: "Authenticated Access session-cookie smoke has not completed",
      authMode: "access_session_cookie",
      endpoint,
    };
  } catch (error) {
    return {
      status: "incomplete",
      reason: error.message,
      authMode: "access_session_cookie",
      endpoint: typeof env?.MCP_ENDPOINT === "string" && env.MCP_ENDPOINT.length > 0
        ? env.MCP_ENDPOINT
        : null,
    };
  }
}

export function buildMcpReleaseMetadata({
  versionId,
  previousVersionId,
  endpoint,
  smoke,
  oauthSmoke,
  recovery,
}) {
  return {
    mcpVersionId: versionId ?? null,
    previousMcpVersionId: previousVersionId ?? null,
    mcpEndpoint: endpoint ?? null,
    mcpProtocol: MCP_RELEASE_PROTOCOL,
    mcpToolVersion: MCP_RELEASE_TOOL_VERSION,
    mcpSmoke: smoke ?? null,
    mcpOAuthSmoke: oauthSmoke ?? {
      status: "operator_required",
      reason: "Codex Managed OAuth client flow must be verified separately",
    },
    mcpRecovery: recovery ?? null,
  };
}
