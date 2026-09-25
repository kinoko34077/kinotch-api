import assert from "node:assert/strict";
import test from "node:test";

import {
  JEV_AUDIT_REST_ENDPOINT,
  runJevAuditMcpSmoke,
  runJevAuditRestSmoke,
} from "../scripts/smoke-jev-audit.mjs";

function report(overrides = {}) {
  return {
    profile: "development",
    files_scanned: 2,
    batches: 1,
    aggregate: { overall: { status: "review", risk: 0.6, status_trigger: null } },
    provenance: { audit_semantics_version: "0.2.12", resolved_model: "jev-1.13.0" },
    ...overrides,
  };
}

test("REST smoke sends a tiny authenticated fixture and validates provenance", async () => {
  let seen;
  const result = await runJevAuditRestSmoke({
    token: "rest-secret",
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify(report()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(seen.url, JEV_AUDIT_REST_ENDPOINT);
  assert.equal(seen.init.headers.Authorization, "Bearer rest-secret");
  const body = JSON.parse(seen.init.body);
  assert.equal(body.files.length, 2);
  assert.equal(body.profile, "development");
  assert.equal(result.status, "passed");
  assert.equal(result.resolvedModel, "jev-1.13.0");
  assert.equal(result.auditSemanticsVersion, "0.2.12");
});

test("REST smoke fails closed when the resolved model drifts from the pinned contract", async () => {
  await assert.rejects(
    runJevAuditRestSmoke({
      token: "rest-secret",
      fetchImpl: async () => Response.json(report({
        provenance: { audit_semantics_version: "0.2.12", resolved_model: "jev-unexpected" },
      })),
    }),
    /jev-audit smoke failed/,
  );
});

test("MCP recovery smoke uses Access service token and avoids billable tool calls", async () => {
  const methods = [];
  const fetchImpl = async (_url, init) => {
    assert.equal(init.headers["CF-Access-Client-Id"], "client-id");
    assert.equal(init.headers["CF-Access-Client-Secret"], "client-secret");
    assert.equal(init.headers.Cookie, undefined);
    const rpc = JSON.parse(init.body);
    methods.push(rpc.method);
    if (rpc.method === "notifications/initialized") return new Response("", { status: 202 });
    if (rpc.method === "tools/list") {
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { tools: [{ name: "audit_files" }, { name: "list_profiles" }] } });
    }
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result: {} });
  };

  const result = await runJevAuditMcpSmoke({
    endpoint: "https://jev-audit-mcp.kinotch.workers.dev/mcp",
    accessClientId: "client-id",
    accessClientSecret: "client-secret",
    fetchImpl,
    checkToolCall: false,
  });
  assert.equal(result.status, "passed");
  assert.equal(result.authMode, "access_service_token");
  assert.deepEqual(methods, ["initialize", "notifications/initialized", "tools/list"]);
});

test("full MCP smoke validates list_profiles before audit_files through Service Token auth", async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    assert.equal(init.headers["CF-Access-Client-Id"], "client-id");
    assert.equal(init.headers["CF-Access-Client-Secret"], "client-secret");
    assert.equal(init.headers.Cookie, undefined);
    const rpc = JSON.parse(init.body);
    calls.push(rpc);
    if (rpc.method === "notifications/initialized") return new Response("", { status: 202 });
    if (rpc.method === "tools/list") {
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { tools: [{ name: "audit_files" }, { name: "list_profiles" }] } });
    }
    if (rpc.method === "tools/call" && rpc.params.name === "list_profiles") {
      return Response.json({
        jsonrpc: "2.0",
        id: rpc.id,
        result: {
          content: [{ type: "text", text: "development, generic" }],
          structuredContent: { profiles: ["development", "generic"] },
        },
      });
    }
    if (rpc.method === "tools/call" && rpc.params.name === "audit_files") {
      return Response.json({
        jsonrpc: "2.0",
        id: rpc.id,
        result: {
          content: [{ type: "text", text: "status=review risk=0.6" }],
          structuredContent: report(),
        },
      });
    }
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result: {} });
  };

  const result = await runJevAuditMcpSmoke({
    endpoint: "https://jev-audit-mcp.kinotch.workers.dev/mcp",
    accessClientId: "client-id",
    accessClientSecret: "client-secret",
    fetchImpl,
    checkToolCall: true,
  });
  const toolCalls = calls.filter((item) => item.method === "tools/call");
  assert.deepEqual(toolCalls.map((item) => item.params.name), ["list_profiles", "audit_files"]);
  assert.deepEqual(result.profiles, ["development", "generic"]);
  assert.equal(result.status, "passed");
  assert.equal(result.authMode, "access_service_token");
  assert.equal(result.resolvedModel, "jev-1.13.0");
  assert.equal(result.auditSemanticsVersion, "0.2.12");
});

test("full MCP smoke rejects an unexpected profile surface", async () => {
  const fetchImpl = async (_url, init) => {
    const rpc = JSON.parse(init.body);
    if (rpc.method === "notifications/initialized") return new Response("", { status: 202 });
    if (rpc.method === "tools/list") {
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { tools: [{ name: "audit_files" }, { name: "list_profiles" }] } });
    }
    if (rpc.method === "tools/call" && rpc.params.name === "list_profiles") {
      return Response.json({
        jsonrpc: "2.0",
        id: rpc.id,
        result: { structuredContent: { profiles: ["development", "unexpected"] } },
      });
    }
    throw new Error("audit_files must not run after invalid profiles");
  };

  await assert.rejects(
    runJevAuditMcpSmoke({
      endpoint: "https://jev-audit-mcp.kinotch.workers.dev/mcp",
      accessClientId: "client-id",
      accessClientSecret: "client-secret",
      fetchImpl,
      checkToolCall: true,
    }),
    /jev-audit smoke failed/,
  );
});

test("legacy session cookie alone is rejected for automated MCP smoke", async () => {
  await assert.rejects(
    runJevAuditMcpSmoke({
      endpoint: "https://jev-audit-mcp.kinotch.workers.dev/mcp",
      accessCookie: "CF_Authorization=session",
      fetchImpl: async () => {
        throw new Error("fetch must not run");
      },
    }),
    /CF_ACCESS_CLIENT_ID/,
  );
});
