import test from "node:test";
import assert from "node:assert/strict";
import {
  MCP_RELEASE_CONFIG,
  MCP_RELEASE_PROTOCOL,
  MCP_RELEASE_TOOL_VERSION,
  buildMcpReleaseMetadata,
  createMcpDeployArgs,
  resolveMcpWorkerVars,
  resolveMcpSmokeInputs,
  resolveMcpSmokeState,
} from "../scripts/mcp-release.mjs";

const versionId = "12345678-1234-4234-8234-123456789abc";

test("MCP release metadata uses the dedicated Worker config and protocol", () => {
  assert.equal(MCP_RELEASE_CONFIG, "wrangler.semantic-compression-mcp.jsonc");
  assert.equal(MCP_RELEASE_PROTOCOL, "streamable-http");
  assert.equal(MCP_RELEASE_TOOL_VERSION, "compress_text/v1");
  assert.deepEqual(buildMcpReleaseMetadata({
    versionId,
    previousVersionId: null,
    endpoint: "https://mcp.example.test/mcp",
    smoke: { status: "operator_required" },
    recovery: null,
  }), {
    mcpVersionId: versionId,
    previousMcpVersionId: null,
    mcpEndpoint: "https://mcp.example.test/mcp",
    mcpProtocol: "streamable-http",
    mcpToolVersion: "compress_text/v1",
    mcpSmoke: { status: "operator_required" },
    mcpOAuthSmoke: {
      status: "operator_required",
      reason: "Codex Managed OAuth client flow must be verified separately",
    },
    mcpRecovery: null,
  });
});

test("MCP production deploy requires worker vars and authenticated smoke inputs", () => {
  assert.throws(() => resolveMcpWorkerVars({}), /TEAM_DOMAIN/);
  assert.throws(() => resolveMcpSmokeInputs({ TEAM_DOMAIN: "team.example.com", POLICY_AUD: "audience-tag" }), /MCP_ENDPOINT/);
  assert.deepEqual(resolveMcpWorkerVars({ TEAM_DOMAIN: " https://team.example.com/ ", POLICY_AUD: " audience-tag " }), {
    TEAM_DOMAIN: "https://team.example.com/",
    POLICY_AUD: "audience-tag",
  });
  assert.deepEqual(createMcpDeployArgs({
    env: { TEAM_DOMAIN: "https://team.example.com", POLICY_AUD: "audience-tag" },
    dryRun: true,
  }), [
    "wrangler",
    "deploy",
    "--config",
    "wrangler.semantic-compression-mcp.jsonc",
    "--var",
    "TEAM_DOMAIN:https://team.example.com",
    "--var",
    "POLICY_AUD:audience-tag",
    "--dry-run",
  ]);
});

test("MCP smoke remains incomplete until the authenticated session-cookie smoke runs", () => {
  assert.deepEqual(resolveMcpSmokeState({}), {
    status: "incomplete",
    reason: "MCP production release requires MCP_ENDPOINT",
    authMode: "access_session_cookie",
    endpoint: null,
  });
  assert.deepEqual(resolveMcpSmokeState({
    MCP_ENDPOINT: "https://mcp.example.test/mcp",
    TEAM_DOMAIN: "team.example.com",
    POLICY_AUD: "audience-tag",
  }), {
    status: "incomplete",
    reason: "MCP production release requires MCP_SMOKE_ACCESS_COOKIE",
    authMode: "access_session_cookie",
    endpoint: "https://mcp.example.test/mcp",
  });
});
