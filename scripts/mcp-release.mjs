export const MCP_RELEASE_WORKER_NAME = "semantic-compression-mcp";
export const MCP_RELEASE_CONFIG = "wrangler.semantic-compression-mcp.jsonc";
export const MCP_RELEASE_PROTOCOL = "streamable-http";
export const MCP_RELEASE_TOOL_VERSION = "compress_text/v1";
export const MCP_RELEASE_HOST = "semantic-compression-mcp.kinotch.workers.dev";
export const MCP_RELEASE_ENDPOINT = `https://${MCP_RELEASE_HOST}/mcp`;

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
  const accessClientId = requiredEnvValue(env, "CF_ACCESS_CLIENT_ID");
  const accessClientSecret = requiredEnvValue(env, "CF_ACCESS_CLIENT_SECRET");
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("MCP_ENDPOINT must be a valid URL");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.pathname !== "/mcp"
    || parsed.hostname !== MCP_RELEASE_HOST
  ) {
    throw new Error(`MCP_ENDPOINT must target ${MCP_RELEASE_ENDPOINT}`);
  }
  return {
    endpoint: parsed.toString(),
    accessClientId,
    accessClientSecret,
  };
}

export function resolveMcpSmokeState(env = process.env) {
  try {
    const { endpoint } = resolveMcpSmokeInputs(env);
    resolveMcpWorkerVars(env);
    return {
      status: "incomplete",
      reason: "Authenticated Access service-token smoke has not completed",
      authMode: "access_service_token",
      endpoint,
    };
  } catch (error) {
    return {
      status: "incomplete",
      reason: error.message,
      authMode: "access_service_token",
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
