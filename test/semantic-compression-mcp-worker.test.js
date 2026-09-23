import test from "node:test";
import assert from "node:assert/strict";
import { createCompressionMcpWorker } from "../src/semantic-compression-mcp-worker.js";

function accessApproved() {
  return { ok: true };
}

function allowRateLimiter() {
  return {
    limit() {
      return Promise.resolve({ success: true });
    },
  };
}

function mcpRequest(body, extraHeaders = {}) {
  return new Request("https://mcp.example.test/mcp", {
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

test("MCP route rejects Access failures before handler or binding dispatch", async () => {
  let bindingCalls = 0;
  const worker = createCompressionMcpWorker({
    verifyAccessJwtImpl: async () => ({ ok: false, code: "authentication_failed" }),
  });
  const response = await worker.fetch(mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }), {
    COMPRESSION: { fetch: async () => { bindingCalls += 1; return new Response(); } },
  }, {});

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_failed" });
  assert.equal(bindingCalls, 0);
});

test("MCP exposes only compress_text and fixed semantic profile", async () => {
  const calls = [];
  const worker = createCompressionMcpWorker({ verifyAccessJwtImpl: accessApproved });
  const env = {
    MCP_RATE_LIMITER: allowRateLimiter(),
    COMPRESSION: {
      fetch: async (request) => {
        calls.push({ headers: request.headers, body: await request.json() });
        return new Response(JSON.stringify({
          compressed_text: "圧縮結果",
          profile: "semantic-dense-v1",
          prompt_version: "semantic-dense-v1",
          model: "gemini-3.5-flash-lite",
          input_chars: 2,
          output_chars: 4,
          warnings: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
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
  assert.deepEqual(toolsPayload.result.tools.map((tool) => tool.name), ["compress_text"]);
  assert.deepEqual(Object.keys(toolsPayload.result.tools[0].inputSchema.properties), ["text"]);

  const toolCall = await worker.fetch(mcpRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "compress_text", arguments: { text: "本文" } },
  }), env, {});
  const toolPayload = await responseJson(toolCall);
  assert.equal(toolPayload.result.isError, undefined);
  assert.equal(toolPayload.result.content[0].text, "圧縮結果");
  assert.deepEqual(toolPayload.result.structuredContent, {
    profile: "semantic-dense-v1",
    prompt_version: "semantic-dense-v1",
    model: "gemini-3.5-flash-lite",
    input_chars: 2,
    output_chars: 4,
    warnings: [],
  });
  assert.deepEqual(calls, [{
    headers: calls[0].headers,
    body: { text: "本文", profile: "semantic-dense-v1" },
  }]);
  assert.equal(calls[0].headers.get("Authorization"), null);
});

test("MCP compression rate limit runs before the Service Binding and uses client IP", async () => {
  const events = [];
  const worker = createCompressionMcpWorker({ verifyAccessJwtImpl: accessApproved });
  const response = await worker.fetch(mcpRequest({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "compress_text", arguments: { text: "本文" } },
  }, { "CF-Connecting-IP": "198.51.100.7" }), {
    MCP_RATE_LIMITER: {
      limit(input) {
        events.push({ type: "rate", key: input.key });
        return Promise.resolve({ success: true });
      },
    },
    COMPRESSION: {
      fetch: async () => {
        events.push({ type: "compression" });
        return new Response(JSON.stringify({
          compressed_text: "圧縮結果",
          profile: "semantic-dense-v1",
          prompt_version: "semantic-dense-v1",
          model: "gemini-3.5-flash-lite",
          input_chars: 2,
          output_chars: 4,
          warnings: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
  }, {});
  const payload = await responseJson(response);

  assert.equal(payload.result.isError, undefined);
  assert.deepEqual(events, [
    { type: "rate", key: "semantic-compression-mcp:198.51.100.7" },
    { type: "compression" },
  ]);
});

test("MCP compression rate limit blocks without calling the Service Binding", async () => {
  let bindingCalls = 0;
  const worker = createCompressionMcpWorker({ verifyAccessJwtImpl: accessApproved });
  const response = await worker.fetch(mcpRequest({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "compress_text", arguments: { text: "本文" } },
  }), {
    MCP_RATE_LIMITER: { limit: async () => ({ success: false }) },
    COMPRESSION: { fetch: async () => { bindingCalls += 1; return new Response(); } },
  }, {});
  const payload = await responseJson(response);

  assert.equal(payload.result.isError, true);
  assert.equal(payload.result.content[0].text, "rate_limited");
  assert.equal(bindingCalls, 0);
});

test("MCP compression rate limit fails closed when the binding is unavailable", async () => {
  let bindingCalls = 0;
  const worker = createCompressionMcpWorker({ verifyAccessJwtImpl: accessApproved });
  const response = await worker.fetch(mcpRequest({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name: "compress_text", arguments: { text: "本文" } },
  }), {
    COMPRESSION: { fetch: async () => { bindingCalls += 1; return new Response(); } },
  }, {});
  const payload = await responseJson(response);

  assert.equal(payload.result.isError, true);
  assert.equal(payload.result.content[0].text, "rate_limiter_unavailable");
  assert.equal(bindingCalls, 0);
});

test("MCP tool rejects caller profile and prompt fields without binding access", async () => {
  let bindingCalls = 0;
  const worker = createCompressionMcpWorker({ verifyAccessJwtImpl: accessApproved });
  const response = await worker.fetch(mcpRequest({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "compress_text",
      arguments: { text: "本文", profile: "compact-v1", prompt: "override", model: "other" },
    },
  }), { COMPRESSION: { fetch: async () => { bindingCalls += 1; return new Response(); } } }, {});
  const payload = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(payload.result.isError, true);
  assert.equal(bindingCalls, 0);
});

test("unknown MCP paths are not exposed", async () => {
  const worker = createCompressionMcpWorker({ verifyAccessJwtImpl: accessApproved });
  const response = await worker.fetch(new Request("https://mcp.example.test/health"), {}, {});

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
});
