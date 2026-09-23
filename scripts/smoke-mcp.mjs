export const MCP_SMOKE_TIMEOUT_MS = 60_000;

export class McpSmokeError extends Error {
  constructor(message = "MCP smoke failed") {
    super(message);
    this.name = "McpSmokeError";
    this.code = "mcp_smoke_failed";
  }
}

function parseEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    throw new Error("MCP_ENDPOINT is required");
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("MCP_ENDPOINT must be a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("MCP_ENDPOINT must use HTTPS");
  if (url.username || url.password) throw new Error("MCP_ENDPOINT must not include credentials");
  if (url.search || url.hash) throw new Error("MCP_ENDPOINT must not include query or fragment");
  if (url.pathname !== "/mcp") throw new Error("MCP_ENDPOINT must point to /mcp");
  return url.toString();
}

async function readRpcResponse(response) {
  if (response.status !== 200) throw new McpSmokeError();
  const body = await response.text();
  try {
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      const dataLine = body.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) throw new Error("missing SSE data");
      return JSON.parse(dataLine.slice("data:".length).trim());
    }
    return JSON.parse(body);
  } catch {
    throw new McpSmokeError();
  }
}

function assertRpcResult(payload) {
  if (!payload || payload.error || !payload.result) throw new McpSmokeError();
  return payload.result;
}

export async function runMcpSmoke({
  endpoint,
  accessCookie,
  fetchImpl = globalThis.fetch,
  timeoutMs = MCP_SMOKE_TIMEOUT_MS,
} = {}) {
  const target = parseEndpoint(endpoint);
  if (typeof accessCookie !== "string" || accessCookie.length === 0) {
    throw new Error("MCP_SMOKE_ACCESS_COOKIE is required for authenticated MCP smoke");
  }

  let id = 0;
  async function request(method, params) {
    const controller = new AbortController();
    const timeout = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-06-18",
          Cookie: accessCookie,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: controller.signal,
      });
      return assertRpcResult(await readRpcResponse(response));
    } catch (error) {
      if (error instanceof McpSmokeError) throw error;
      throw new McpSmokeError();
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function notify(method, params) {
    const controller = new AbortController();
    const timeout = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-06-18",
          Cookie: accessCookie,
        },
        body: JSON.stringify({ jsonrpc: "2.0", method, params }),
        signal: controller.signal,
      });
      if (![200, 202, 204].includes(response.status)) throw new McpSmokeError();
    } catch (error) {
      if (error instanceof McpSmokeError) throw error;
      throw new McpSmokeError();
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "kinotch-mcp-smoke", version: "1" },
  });
  await notify("notifications/initialized", {});
  const tools = await request("tools/list", {});
  if (!Array.isArray(tools.tools) || tools.tools.length !== 1 || tools.tools[0]?.name !== "compress_text") {
    throw new McpSmokeError();
  }
  const result = await request("tools/call", {
    name: "compress_text",
    arguments: { text: "MCP smoke text" },
  });
  if (result.isError === true) throw new McpSmokeError();
  if (typeof result.content?.[0]?.text !== "string" || result.content[0].text.length === 0) {
    throw new McpSmokeError();
  }
  const provenance = result.structuredContent;
  if (
    provenance?.profile !== "semantic-dense-v1" ||
    provenance?.prompt_version !== "semantic-dense-v1" ||
    typeof provenance?.model !== "string" ||
    !Number.isSafeInteger(provenance?.input_chars) ||
    !Number.isSafeInteger(provenance?.output_chars) ||
    !Array.isArray(provenance?.warnings)
  ) {
    throw new McpSmokeError();
  }

  return {
    status: "passed",
    httpStatus: 200,
    authMode: "access_session_cookie",
    endpoint: target,
    tool: "compress_text",
    profile: provenance.profile,
    model: provenance.model,
    inputChars: provenance.input_chars,
    outputChars: provenance.output_chars,
  };
}

if (process.argv[1]?.endsWith("smoke-mcp.mjs")) {
  const result = await runMcpSmoke({
    endpoint: process.env.MCP_ENDPOINT,
    accessCookie: process.env.MCP_SMOKE_ACCESS_COOKIE,
  });
  console.log(JSON.stringify(result, null, 2));
}
