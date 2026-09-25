import test from "node:test";
import assert from "node:assert/strict";
import { runMcpSmoke } from "../scripts/smoke-mcp.mjs";
import { resolveMcpSmokeInputs } from "../scripts/mcp-release.mjs";
import {
  ALLOWED_PRODUCTION_SECRET_KEYS,
  MAPPER_MODES,
  requiredKeysForMode,
} from "../scripts/production-secret-mapper.mjs";

function rpcResult(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("MCP smoke authenticates with Cloudflare Access service-token headers and no Cookie", async () => {
  const calls = [];
  const result = await runMcpSmoke({
    endpoint: "https://mcp.example.test/mcp",
    accessClientId: "client-id-fixture",
    accessClientSecret: "client-secret-fixture",
    fetchImpl: async (_url, init) => {
      calls.push(init);
      const body = JSON.parse(init.body);
      if (body.method === "initialize") return rpcResult(body.id, { protocolVersion: "2025-06-18" });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/list") return rpcResult(body.id, { tools: [{ name: "compress_text" }] });
      return rpcResult(body.id, {
        content: [{ type: "text", text: "compressed" }],
        structuredContent: {
          profile: "semantic-dense-v1",
          prompt_version: "semantic-dense-v1.1",
          model: "gemini-3.5-flash-lite",
          input_chars: 2,
          output_chars: 4,
          warnings: [],
        },
      });
    },
  });

  assert.equal(result.authMode, "access_service_token");
  assert.equal(calls[0].headers["CF-Access-Client-Id"], "client-id-fixture");
  assert.equal(calls[0].headers["CF-Access-Client-Secret"], "client-secret-fixture");
  assert.equal(calls[0].headers.Cookie, undefined);
});

test("MCP release requires both service-token credentials and rejects the legacy cookie", () => {
  assert.deepEqual(resolveMcpSmokeInputs({
    MCP_ENDPOINT: "https://semantic-compression-mcp.kinotch.workers.dev/mcp",
    CF_ACCESS_CLIENT_ID: "client-id-fixture",
    CF_ACCESS_CLIENT_SECRET: "client-secret-fixture",
  }), {
    endpoint: "https://semantic-compression-mcp.kinotch.workers.dev/mcp",
    accessClientId: "client-id-fixture",
    accessClientSecret: "client-secret-fixture",
  });

  assert.throws(() => resolveMcpSmokeInputs({
    MCP_ENDPOINT: "https://semantic-compression-mcp.kinotch.workers.dev/mcp",
    MCP_SMOKE_ACCESS_COOKIE: "CF_Authorization=legacy-cookie",
  }), /CF_ACCESS_CLIENT_ID/);
});

test("production secret mapper preserves the core service-token mode while allowing Jev production inputs", () => {
  assert.deepEqual([...ALLOWED_PRODUCTION_SECRET_KEYS], [
    "TEAM_DOMAIN",
    "POLICY_AUD",
    "MCP_ENDPOINT",
    "CF_ACCESS_CLIENT_ID",
    "CF_ACCESS_CLIENT_SECRET",
    "COMPRESSION_SMOKE_TOKEN",
    "JEV_AUDIT_MCP_POLICY_AUD",
    "JEV_AUDIT_SMOKE_TOKEN",
    "JEV_AUDIT_MCP_SMOKE_ACCESS_COOKIE",
  ]);
  assert.deepEqual(requiredKeysForMode(MAPPER_MODES.MCP_SMOKE), [
    "MCP_ENDPOINT",
    "CF_ACCESS_CLIENT_ID",
    "CF_ACCESS_CLIENT_SECRET",
  ]);
  assert.equal(ALLOWED_PRODUCTION_SECRET_KEYS.includes("MCP_SMOKE_ACCESS_COOKIE"), false);
});
