import test from "node:test";
import assert from "node:assert/strict";
import {
  MCP_RELEASE_CONFIG,
  MCP_RELEASE_ENDPOINT,
  MCP_RELEASE_HOST,
  MCP_RELEASE_PROTOCOL,
  MCP_RELEASE_TOOL_VERSION,
  buildMcpReleaseMetadata,
  createMcpDeployArgs,
  resolveMcpWorkerVars,
  resolveMcpSmokeInputs,
  resolveMcpSmokeState,
} from "../scripts/mcp-release.mjs";

const versionId = "12345678-1234-4234-8234-123456789abc";
const serviceTokenEnv = {
  MCP_ENDPOINT: "https://semantic-compression-mcp.kinotch.workers.dev/mcp",
  CF_ACCESS_CLIENT_ID: "client-id-fixture",
  CF_ACCESS_CLIENT_SECRET: "client-secret-fixture",
};

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
  assert.equal(MCP_RELEASE_HOST, "semantic-compression-mcp.kinotch.workers.dev");
  assert.equal(MCP_RELEASE_ENDPOINT, "https://semantic-compression-mcp.kinotch.workers.dev/mcp");
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

test("MCP release smoke requires both Access service-token credentials", () => {
  assert.throws(
    () => resolveMcpSmokeInputs({ MCP_ENDPOINT: MCP_RELEASE_ENDPOINT }),
    /CF_ACCESS_CLIENT_ID/,
  );
  assert.throws(
    () => resolveMcpSmokeInputs({ MCP_ENDPOINT: MCP_RELEASE_ENDPOINT, CF_ACCESS_CLIENT_ID: "client-id" }),
    /CF_ACCESS_CLIENT_SECRET/,
  );
  assert.deepEqual(resolveMcpSmokeInputs(serviceTokenEnv), {
    endpoint: MCP_RELEASE_ENDPOINT,
    accessClientId: "client-id-fixture",
    accessClientSecret: "client-secret-fixture",
  });
});

test("MCP release smoke rejects an endpoint for another Worker", () => {
  assert.throws(
    () => resolveMcpSmokeInputs({
      ...serviceTokenEnv,
      MCP_ENDPOINT: "https://other-worker.kinotch.workers.dev/mcp",
    }),
    /MCP_ENDPOINT must target https:\/\/semantic-compression-mcp\.kinotch\.workers\.dev\/mcp/,
  );
  assert.throws(
    () => resolveMcpSmokeInputs({
      ...serviceTokenEnv,
      MCP_ENDPOINT: "https://semantic-compression-mcp.kinotch.workers.dev:8443/mcp",
    }),
    /MCP_ENDPOINT must target https:\/\/semantic-compression-mcp\.kinotch\.workers\.dev\/mcp/,
  );
});

test("MCP smoke remains incomplete until the authenticated service-token smoke runs", () => {
  assert.deepEqual(resolveMcpSmokeState({}), {
    status: "incomplete",
    reason: "MCP production release requires MCP_ENDPOINT",
    authMode: "access_service_token",
    endpoint: null,
  });
  assert.deepEqual(resolveMcpSmokeState({
    MCP_ENDPOINT: MCP_RELEASE_ENDPOINT,
    CF_ACCESS_CLIENT_ID: "client-id-fixture",
    TEAM_DOMAIN: "team.example.com",
    POLICY_AUD: "audience-tag",
  }), {
    status: "incomplete",
    reason: "MCP production release requires CF_ACCESS_CLIENT_SECRET",
    authMode: "access_service_token",
    endpoint: MCP_RELEASE_ENDPOINT,
  });
  assert.deepEqual(resolveMcpSmokeState({
    ...serviceTokenEnv,
    TEAM_DOMAIN: "team.example.com",
    POLICY_AUD: "audience-tag",
  }), {
    status: "incomplete",
    reason: "Authenticated Access service-token smoke has not completed",
    authMode: "access_service_token",
    endpoint: MCP_RELEASE_ENDPOINT,
  });
});
