export const JEV_AUDIT_PRIVATE_WORKER_NAME = "jev-audit";
export const JEV_AUDIT_PRIVATE_CONFIG = "wrangler.jev-audit.jsonc";
export const JEV_AUDIT_MCP_WORKER_NAME = "jev-audit-mcp";
export const JEV_AUDIT_MCP_CONFIG = "wrangler.jev-audit-mcp.jsonc";
export const JEV_AUDIT_MCP_HOST = "jev-audit-mcp.kinotch.workers.dev";
export const JEV_AUDIT_MCP_ENDPOINT = `https://${JEV_AUDIT_MCP_HOST}/mcp`;
export const JEV_AUDIT_REST_ENDPOINT = "https://api.kinotch.workers.dev/v1/audit";

function requiredEnvValue(env, name) {
  const value = env?.[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`jev-audit production release requires ${name}`);
  }
  return value.trim();
}

export function resolveJevAuditMcpWorkerVars(env = process.env) {
  return {
    TEAM_DOMAIN: requiredEnvValue(env, "TEAM_DOMAIN"),
    POLICY_AUD: requiredEnvValue(env, "JEV_AUDIT_MCP_POLICY_AUD"),
  };
}

export function resolveJevAuditReleaseInputs(env = process.env) {
  const vars = resolveJevAuditMcpWorkerVars(env);
  return {
    vars,
    restSmokeToken: requiredEnvValue(env, "JEV_AUDIT_SMOKE_TOKEN"),
    mcpSmoke: {
      endpoint: JEV_AUDIT_MCP_ENDPOINT,
      accessCookie: requiredEnvValue(env, "JEV_AUDIT_MCP_SMOKE_ACCESS_COOKIE"),
    },
  };
}

export function createJevAuditPrivateDeployArgs({ dryRun = false } = {}) {
  return [
    "wrangler",
    "deploy",
    "--config",
    JEV_AUDIT_PRIVATE_CONFIG,
    ...(dryRun ? ["--dry-run"] : []),
  ];
}

export function createJevAuditMcpDeployArgs({ env = process.env, dryRun = false } = {}) {
  const vars = resolveJevAuditMcpWorkerVars(env);
  return [
    "wrangler",
    "deploy",
    "--config",
    JEV_AUDIT_MCP_CONFIG,
    "--var",
    `TEAM_DOMAIN:${vars.TEAM_DOMAIN}`,
    "--var",
    `POLICY_AUD:${vars.POLICY_AUD}`,
    ...(dryRun ? ["--dry-run"] : []),
  ];
}

export function buildJevAuditReleaseMetadata({
  privateVersionId,
  previousPrivateVersionId,
  mcpVersionId,
  previousMcpVersionId,
  restSmoke,
  mcpSmoke,
  privateRecovery,
  mcpRecovery,
} = {}) {
  return {
    jevAuditPrivateVersionId: privateVersionId ?? null,
    previousJevAuditPrivateVersionId: previousPrivateVersionId ?? null,
    jevAuditMcpVersionId: mcpVersionId ?? null,
    previousJevAuditMcpVersionId: previousMcpVersionId ?? null,
    jevAuditRestEndpoint: JEV_AUDIT_REST_ENDPOINT,
    jevAuditMcpEndpoint: JEV_AUDIT_MCP_ENDPOINT,
    jevAuditRestSmoke: restSmoke ?? null,
    jevAuditMcpSmoke: mcpSmoke ?? null,
    jevAuditPrivateRecovery: privateRecovery ?? null,
    jevAuditMcpRecovery: mcpRecovery ?? null,
  };
}
