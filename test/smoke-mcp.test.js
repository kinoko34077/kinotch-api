import test from "node:test";
import assert from "node:assert/strict";
import { runMcpSmoke } from "../scripts/smoke-mcp.mjs";

function rpcResult(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("MCP smoke completes initialize lifecycle before tools/list and compress_text call", async () => {
  const calls = [];
  const result = await runMcpSmoke({
    endpoint: "https://mcp.example.test/mcp",
    accessCookie: "CF_Authorization=secret-cookie",
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      const body = JSON.parse(init.body);
      if (body.method === "initialize") return rpcResult(body.id, { protocolVersion: "2025-06-18" });
      if (body.method === "notifications/initialized") {
        assert.equal(body.id, undefined);
        return new Response(null, { status: 202 });
      }
      if (body.method === "tools/list") return rpcResult(body.id, { tools: [{ name: "compress_text" }] });
      return rpcResult(body.id, {
        content: [{ type: "text", text: "圧縮結果" }],
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

  assert.deepEqual(result, {
    status: "passed",
    httpStatus: 200,
    authMode: "access_session_cookie",
    endpoint: "https://mcp.example.test/mcp",
    tool: "compress_text",
    profile: "semantic-dense-v1",
    model: "gemini-3.5-flash-lite",
    inputChars: 2,
    outputChars: 4,
  });
  assert.deepEqual(calls.map(({ body }) => body.method), [
    "initialize",
    "notifications/initialized",
    "tools/list",
    "tools/call",
  ]);
  assert.equal(calls[0].init.headers.Cookie, "CF_Authorization=secret-cookie");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.deepEqual(calls[3].body.params.arguments, { text: "MCP smoke text" });
});

test("MCP recovery smoke stops after tools/list without calling compression", async () => {
  const methods = [];
  const result = await runMcpSmoke({
    endpoint: "https://mcp.example.test/mcp",
    accessCookie: "CF_Authorization=secret-cookie",
    checkToolCall: false,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      methods.push(body.method);
      if (body.method === "initialize") return rpcResult(body.id, { protocolVersion: "2025-06-18" });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      return rpcResult(body.id, { tools: [{ name: "compress_text" }] });
    },
  });

  assert.deepEqual(result, {
    status: "passed",
    httpStatus: 200,
    authMode: "access_session_cookie",
    endpoint: "https://mcp.example.test/mcp",
    tool: null,
    profile: null,
    model: null,
    inputChars: null,
    outputChars: null,
  });
  assert.deepEqual(methods, ["initialize", "notifications/initialized", "tools/list"]);
});

test("MCP smoke fails safely without endpoint or Access session cookie", async () => {
  await assert.rejects(
    runMcpSmoke({ endpoint: "", accessCookie: "" }),
    /MCP_ENDPOINT is required/,
  );
  await assert.rejects(
    runMcpSmoke({ endpoint: "https://mcp.example.test/mcp", accessCookie: "" }),
    (error) => error.message.includes("MCP_SMOKE_ACCESS_COOKIE") && !error.message.includes("secret"),
  );
});

test("MCP smoke rejects non-HTTPS or credential-ambiguous endpoints before fetch", async () => {
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return new Response();
  };
  for (const endpoint of [
    "http://mcp.example.test/mcp",
    "https://user:pass@mcp.example.test/mcp",
    "https://mcp.example.test/mcp?debug=true",
    "https://mcp.example.test/mcp#fragment",
    "https://mcp.example.test:8443/mcp",
  ]) {
    await assert.rejects(
      runMcpSmoke({ endpoint, accessCookie: "CF_Authorization=secret-cookie", fetchImpl }),
      /MCP_ENDPOINT must use HTTPS|MCP_ENDPOINT must not include credentials|MCP_ENDPOINT must not include query or fragment|MCP_ENDPOINT must not include an explicit port/,
    );
  }
  assert.equal(fetchCalls, 0);
});

test("MCP smoke rejects unsafe protocol results without echoing response bodies", async () => {
  const secret = "raw-mcp-secret";
  await assert.rejects(
    runMcpSmoke({
      endpoint: "https://mcp.example.test/mcp",
      accessCookie: "CF_Authorization=secret-cookie",
      fetchImpl: async () => new Response(JSON.stringify({ error: secret }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
    }),
    (error) => error.code === "mcp_smoke_failed" && !error.message.includes(secret),
  );
});

test("MCP smoke reports safe HTTP diagnostics without echoing an Access error body", async () => {
  const secret = "raw-access-secret";
  await assert.rejects(
    runMcpSmoke({
      endpoint: "https://mcp.example.test/mcp",
      accessCookie: "CF_Authorization=secret-cookie",
      fetchImpl: async () => new Response(JSON.stringify({
        errors: [{ code: 1003, message: secret }],
      }), {
        status: 401,
        headers: { "Content-Type": "application/json; charset=UTF-8" },
      }),
    }),
    (error) => error.message.includes("status 401")
      && error.message.includes("content-type application/json")
      && error.message.includes("code 1003")
      && !error.message.includes(secret),
  );
});

test("MCP smoke reports notification HTTP status and content type safely", async () => {
  let calls = 0;
  await assert.rejects(
    runMcpSmoke({
      endpoint: "https://mcp.example.test/mcp",
      accessCookie: "CF_Authorization=secret-cookie",
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return rpcResult(1, { protocolVersion: "2025-06-18" });
        return new Response("access denied", {
          status: 403,
          headers: { "Content-Type": "text/plain" },
        });
      },
    }),
    (error) => error.message.includes("status 403")
      && error.message.includes("content-type text/plain")
      && !error.message.includes("access denied"),
  );
});
