import assert from "node:assert/strict";
import test from "node:test";

import { REMOTE_AUDIT_LIMITS } from "../src/jev-audit/contract.js";
import { createJevAuditMcpWorker } from "../src/jev-audit-mcp-worker.js";

function accessApproved() {
  return { ok: true, actorKey: "a".repeat(64) };
}

function allowRateLimiter() {
  return { limit() { return Promise.resolve({ success: true }); } };
}

function mcpRequest(body, extraHeaders = {}) {
  return new Request("https://jev-audit-mcp.example.test/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

async function responseJson(response) {
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = text.split("\n").find((line) => line.startsWith("data:"));
    return JSON.parse(data.slice("data:".length).trim());
  }
  return JSON.parse(text);
}

function auditReport() {
  return {
    profile: "development",
    files_scanned: 1,
    batches: 1,
    aggregate: {
      overall: { status: "clear", risk: 0.1, status_trigger: null },
      signals: {},
      usage: { input_tokens: 10, output_tokens: 0 },
      highest_risk_batches: [],
    },
    truncated_paths: [],
    coverage: { submitted_files: 1, audited_files: 1, truncated_files: 0 },
    provenance: {
      service_version: "remote-v1",
      audit_semantics_version: "0.2.12",
      resolved_model: "jev-1.13.0",
      profile_name: "development",
      batch_count: 1,
      estimated_total_input_chars: 100,
    },
  };
}

test("jev-audit MCP rejects Access failures and unknown paths before dispatch", async () => {
  let handlerCalls = 0;
  const worker = createJevAuditMcpWorker({
    verifyAccessJwtImpl: async () => ({ ok: false, code: "authentication_failed" }),
    createJevAuditMcpHandlerImpl: () => { handlerCalls += 1; return async () => new Response(); },
  });
  const env = { JEV_AUDIT: { fetch: async () => { throw new Error("must not call"); } } };

  const denied = await worker.fetch(mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }), env, {});
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { error: "authentication_failed" });
  assert.equal(handlerCalls, 0);

  const unknown = await worker.fetch(new Request("https://jev-audit-mcp.example.test/other"), env, {});
  assert.equal(unknown.status, 404);
});

test("jev-audit MCP rejects oversized transport body before MCP parsing", async () => {
  let handlerCalls = 0;
  const worker = createJevAuditMcpWorker({
    verifyAccessJwtImpl: accessApproved,
    createJevAuditMcpHandlerImpl: () => { handlerCalls += 1; return async () => new Response(); },
  });
  const response = await worker.fetch(new Request("https://jev-audit-mcp.example.test/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(REMOTE_AUDIT_LIMITS.maxRequestBytes + 1),
    },
  }), {}, {});

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "payload_too_large" });
  assert.equal(handlerCalls, 0);
});

test("jev-audit MCP exposes only audit_files and list_profiles", async () => {
  const upstreamCalls = [];
  const worker = createJevAuditMcpWorker({ verifyAccessJwtImpl: accessApproved });
  const env = {
    JEV_AUDIT_MCP_RATE_LIMITER: allowRateLimiter(),
    JEV_AUDIT: {
      async fetch(request) {
        upstreamCalls.push({
          authorization: request.headers.get("authorization"),
          body: await request.json(),
        });
        return new Response(JSON.stringify(auditReport()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  };

  const initialize = await worker.fetch(mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "fixture", version: "1" },
    },
  }), env, {});
  assert.equal(initialize.status, 200);

  const toolsList = await worker.fetch(mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }), env, {});
  const toolsPayload = await responseJson(toolsList);
  assert.deepEqual(toolsPayload.result.tools.map((tool) => tool.name), ["audit_files", "list_profiles"]);

  const profilesCall = await worker.fetch(mcpRequest({
    jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_profiles", arguments: {} },
  }), env, {});
  const profilesPayload = await responseJson(profilesCall);
  assert.deepEqual(profilesPayload.result.structuredContent, { profiles: ["development", "generic"] });

  const auditCall = await worker.fetch(mcpRequest({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "audit_files",
      arguments: { files: [{ path: "src/app.py", content: "print(1)" }], profile: "development" },
    },
  }), env, {});
  const auditPayload = await responseJson(auditCall);
  assert.equal(auditPayload.result.isError, undefined);
  assert.equal(auditPayload.result.structuredContent.aggregate.overall.status, "clear");
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].authorization, null);
  assert.deepEqual(upstreamCalls[0].body, {
    files: [{ path: "src/app.py", content: "print(1)" }],
    profile: "development",
  });
});

test("jev-audit MCP actor rate limit runs before Service Binding", async () => {
  const events = [];
  const worker = createJevAuditMcpWorker({ verifyAccessJwtImpl: accessApproved });
  const env = {
    JEV_AUDIT_MCP_RATE_LIMITER: {
      limit(input) { events.push({ type: "rate", key: input.key }); return Promise.resolve({ success: false }); },
    },
    JEV_AUDIT: {
      fetch() { events.push({ type: "binding" }); return Promise.resolve(new Response(JSON.stringify(auditReport()))); },
    },
  };

  const response = await worker.fetch(mcpRequest({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "audit_files", arguments: { files: [{ path: "a.py", content: "x" }] } },
  }), env, {});
  const payload = await responseJson(response);

  assert.equal(payload.result.isError, true);
  assert.equal(payload.result.content[0].text, "rate_limited");
  assert.deepEqual(events, [{ type: "rate", key: `jev-audit-mcp:actor:${"a".repeat(64)}` }]);
});
