import assert from "node:assert/strict";
import test from "node:test";

import {
  JEV_AUDIT_REST_ENDPOINT,
  runJevAuditMcpSmoke,
  runJevAuditRestSmoke,
} from "../scripts/smoke-jev-audit.mjs";

function report() {
  return {
    profile: "development",
    files_scanned: 2,
    batches: 1,
    aggregate: { overall: { status: "review", risk: 0.6, status_trigger: null } },
    provenance: { audit_semantics_version: "0.2.12", resolved_model: "jev-1.13.0" },
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
  assert.equal(result.auditSemanticsVersion, "0.2.12");
});

test("MCP recovery smoke performs handshake and tools/list without a billable audit call", async () => {
  const methods = [];
  const fetchImpl = async (_url, init) => {
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
    accessCookie: "CF_Authorization=session",
    fetchImpl,
    checkToolCall: false,
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(methods, ["initialize", "notifications/initialized", "tools/list"]);
});

test("full MCP smoke calls audit_files only when explicitly enabled", async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const rpc = JSON.parse(init.body);
    calls.push(rpc);
    if (rpc.method === "notifications/initialized") return new Response("", { status: 202 });
    if (rpc.method === "tools/list") {
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { tools: [{ name: "audit_files" }, { name: "list_profiles" }] } });
    }
    if (rpc.method === "tools/call") {
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
    accessCookie: "CF_Authorization=session",
    fetchImpl,
    checkToolCall: true,
  });
  const toolCall = calls.find((item) => item.method === "tools/call");
  assert.equal(toolCall.params.name, "audit_files");
  assert.equal(result.status, "passed");
  assert.equal(result.auditSemanticsVersion, "0.2.12");
});
