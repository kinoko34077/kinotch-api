import test from "node:test";
import assert from "node:assert/strict";
import {
  MCP_RELEASE_CONFIG,
  MCP_RELEASE_PROTOCOL,
  MCP_RELEASE_TOOL_VERSION,
  buildMcpReleaseMetadata,
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
    mcpRecovery: null,
  });
});

test("MCP smoke remains operator-required until endpoint and Access vars exist", () => {
  assert.deepEqual(resolveMcpSmokeState({}), {
    status: "operator_required",
    reason: "Cloudflare Access setup and authenticated MCP smoke are required",
    endpoint: null,
  });
  assert.deepEqual(resolveMcpSmokeState({
    MCP_ENDPOINT: "https://mcp.example.test/mcp",
    TEAM_DOMAIN: "team.example.com",
    POLICY_AUD: "audience-tag",
  }), {
    status: "operator_required",
    reason: "Authenticated OAuth smoke must be run by the operator",
    endpoint: "https://mcp.example.test/mcp",
  });
});
