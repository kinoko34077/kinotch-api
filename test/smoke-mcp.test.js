import test from "node:test";
import assert from "node:assert/strict";
import { runMcpSmoke } from "../scripts/smoke-mcp.mjs";

function rpcResult(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("MCP smoke performs one initialize, tools/list, and compress_text call", async () => {
  const calls = [];
  const result = await runMcpSmoke({
    endpoint: "https://mcp.example.test/mcp",
    accessCookie: "CF_Authorization=secret-cookie",
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      const body = JSON.parse(init.body);
      if (body.method === "initialize") return rpcResult(body.id, { protocolVersion: "2025-06-18" });
      if (body.method === "tools/list") return rpcResult(body.id, { tools: [{ name: "compress_text" }] });
      return rpcResult(body.id, {
        content: [{ type: "text", text: "圧縮結果" }],
        structuredContent: {
          profile: "semantic-dense-v1",
          prompt_version: "semantic-dense-v1",
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
  assert.equal(calls.length, 3);
  assert.equal(calls[0].init.headers.Cookie, "CF_Authorization=secret-cookie");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.deepEqual(calls[2].body.params.arguments, { text: "MCP smoke text" });
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
