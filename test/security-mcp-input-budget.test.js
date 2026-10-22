import assert from "node:assert/strict";
import test from "node:test";

import { createCompressionMcpWorker } from "../src/semantic-compression-mcp-worker.js";
import { createJevAuditMcpWorker } from "../src/jev-audit-mcp-worker.js";

function mcpRequest(host, name, args) {
  return new Request("https://" + host + "/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1001,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}

async function responseJson(response) {
  const body = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const line = body.split("\n").find(line => line.startsWith("data:"));
    assert.ok(line, "an SSE response must contain a data message");
    return JSON.parse(line.slice(5).trim());
  }
  return JSON.parse(body);
}

test("real compression MCP rejects an authenticated oversized element tree before schema and binding", async () => {
  let bindingCalls = 0;
  let rateCalls = 0;
  const worker = createCompressionMcpWorker({
    verifyAccessJwtImpl: async () => ({ ok: true }),
  });
  const args = { text: "allowed text" };
  for (let index = 0; index < 32; index++) args["untrusted_" + index] = index;

  const response = await worker.fetch(mcpRequest(
    "compression.example.test", "compress_text", args,
  ), {
    MCP_RATE_LIMITER: { limit: async () => { rateCalls++; return { success: true }; } },
    COMPRESSION: { fetch: async () => { bindingCalls++; throw new Error("unexpected"); } },
  }, {});
  const payload = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(payload.result?.isError, true);
  assert.match(payload.result.content[0].text, /maximum of 16 elements/);
  assert.equal(rateCalls, 0, "reject must happen before post-validation rate limit");
  assert.equal(bindingCalls, 0, "no upstream Service Binding may run");
});

test("real Jev MCP rejects >512 element tree before file schema and binding", async () => {
  let bindingCalls = 0;
  let rateCalls = 0;
  const worker = createJevAuditMcpWorker({
    verifyAccessJwtImpl: async () => ({ ok: true, actorKey: "a".repeat(64) }),
  });
  // 1 files member + 130 array elements + 3 fields per element => 521 elements.
  // The serialized body is small; rejection proves the SDK's structural
  // limit is reached BEFORE the stricter maxFiles schema, not the HTTP byte cap.
  const files = Array.from({ length: 130 }, (_, i) => ({
    path: "file" + i + ".py",
    content: "x",
    change: "y",
  }));
  const response = await worker.fetch(mcpRequest(
    "jev.example.test", "audit_files", { files },
  ), {
    JEV_AUDIT_MCP_RATE_LIMITER: { limit: async () => { rateCalls++; return { success: true }; } },
    JEV_AUDIT: { fetch: async () => { bindingCalls++; throw new Error("unexpected"); } },
  }, {});
  const payload = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(payload.result?.isError, true);
  assert.match(payload.result.content[0].text, /maximum of 512 elements/);
  assert.equal(rateCalls, 0);
  assert.equal(bindingCalls, 0);
});
