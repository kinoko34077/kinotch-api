import {
  JEV_AUDIT_MCP_ENDPOINT,
  JEV_AUDIT_REST_ENDPOINT,
} from "./jev-audit-release.mjs";

export { JEV_AUDIT_REST_ENDPOINT };
export const JEV_AUDIT_SMOKE_TIMEOUT_MS = 60_000;

export class JevAuditSmokeError extends Error {
  constructor(message = "jev-audit smoke failed") {
    super(message);
    this.name = "JevAuditSmokeError";
    this.code = "jev_audit_smoke_failed";
  }
}

const FIXTURE = Object.freeze({
  files: Object.freeze([
    Object.freeze({ path: "SPEC.md", content: "add(a,b) returns the sum of a and b." }),
    Object.freeze({ path: "app.py", content: "def add(a,b):\n    return a-b\n" }),
  ]),
  profile: "development",
});

function assertAuditReport(report) {
  if (!report || typeof report !== "object") throw new JevAuditSmokeError();
  if (!Number.isInteger(report.files_scanned) || report.files_scanned <= 0) throw new JevAuditSmokeError();
  if (!Number.isInteger(report.batches) || report.batches <= 0) throw new JevAuditSmokeError();
  if (!report.aggregate || typeof report.aggregate?.overall?.status !== "string") throw new JevAuditSmokeError();
  if (report.provenance?.audit_semantics_version !== "0.2.12") throw new JevAuditSmokeError();
  if (typeof report.provenance?.resolved_model !== "string" || report.provenance.resolved_model.length === 0) {
    throw new JevAuditSmokeError();
  }
  return report;
}

function requireSecret(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function parseMcpEndpoint(endpoint) {
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("jev-audit MCP endpoint must be a valid URL");
  }
  const expected = new URL(JEV_AUDIT_MCP_ENDPOINT);
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== expected.hostname
    || parsed.pathname !== "/mcp"
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(`jev-audit MCP endpoint must be ${JEV_AUDIT_MCP_ENDPOINT}`);
  }
  return parsed.toString();
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new JevAuditSmokeError("jev-audit smoke timed out");
    throw new JevAuditSmokeError();
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function runJevAuditRestSmoke({
  token,
  fetchImpl = globalThis.fetch,
  timeoutMs = JEV_AUDIT_SMOKE_TIMEOUT_MS,
} = {}) {
  const bearer = requireSecret(token, "JEV_AUDIT_SMOKE_TOKEN");
  const response = await fetchWithTimeout(fetchImpl, JEV_AUDIT_REST_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(FIXTURE),
  }, timeoutMs);
  if (response.status !== 200) throw new JevAuditSmokeError(`jev-audit REST smoke returned status ${response.status}`);
  let report;
  try {
    report = assertAuditReport(await response.json());
  } catch (error) {
    if (error instanceof JevAuditSmokeError) throw error;
    throw new JevAuditSmokeError();
  }
  return {
    status: "passed",
    endpoint: JEV_AUDIT_REST_ENDPOINT,
    httpStatus: 200,
    filesScanned: report.files_scanned,
    batches: report.batches,
    aggregateStatus: report.aggregate.overall.status,
    resolvedModel: report.provenance.resolved_model,
    auditSemanticsVersion: report.provenance.audit_semantics_version,
  };
}

async function readRpcResult(response) {
  if (response.status !== 200) throw new JevAuditSmokeError(`jev-audit MCP smoke returned status ${response.status}`);
  let payload;
  try {
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      const text = await response.text();
      const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) throw new Error("missing data");
      payload = JSON.parse(dataLine.slice("data:".length).trim());
    } else {
      payload = await response.json();
    }
  } catch {
    throw new JevAuditSmokeError();
  }
  if (!payload || payload.error || !payload.result) throw new JevAuditSmokeError();
  return payload.result;
}

export async function runJevAuditMcpSmoke({
  endpoint = JEV_AUDIT_MCP_ENDPOINT,
  accessCookie,
  fetchImpl = globalThis.fetch,
  timeoutMs = JEV_AUDIT_SMOKE_TIMEOUT_MS,
  checkToolCall = false,
} = {}) {
  const target = parseMcpEndpoint(endpoint);
  const cookie = requireSecret(accessCookie, "JEV_AUDIT_MCP_SMOKE_ACCESS_COOKIE");
  let id = 0;

  async function request(method, params) {
    const response = await fetchWithTimeout(fetchImpl, target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
        Cookie: cookie,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    }, timeoutMs);
    return readRpcResult(response);
  }

  async function notify(method, params) {
    const response = await fetchWithTimeout(fetchImpl, target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
        Cookie: cookie,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
    }, timeoutMs);
    if (![200, 202, 204].includes(response.status)) throw new JevAuditSmokeError();
  }

  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "kinotch-jev-audit-smoke", version: "1" },
  });
  await notify("notifications/initialized", {});
  const tools = await request("tools/list", {});
  const names = Array.isArray(tools.tools) ? tools.tools.map((tool) => tool?.name).sort() : [];
  if (names.length !== 2 || names[0] !== "audit_files" || names[1] !== "list_profiles") {
    throw new JevAuditSmokeError();
  }

  if (!checkToolCall) {
    return {
      status: "passed",
      endpoint: target,
      authMode: "access_session_cookie",
      toolCall: false,
    };
  }

  const result = await request("tools/call", {
    name: "audit_files",
    arguments: FIXTURE,
  });
  if (result.isError === true) throw new JevAuditSmokeError();
  const report = assertAuditReport(result.structuredContent);
  return {
    status: "passed",
    endpoint: target,
    authMode: "access_session_cookie",
    toolCall: true,
    tool: "audit_files",
    filesScanned: report.files_scanned,
    batches: report.batches,
    aggregateStatus: report.aggregate.overall.status,
    resolvedModel: report.provenance.resolved_model,
    auditSemanticsVersion: report.provenance.audit_semantics_version,
  };
}

if (process.argv[1]?.endsWith("smoke-jev-audit.mjs")) {
  const mode = process.env.JEV_AUDIT_SMOKE_MODE ?? "rest";
  const result = mode === "mcp"
    ? await runJevAuditMcpSmoke({
        accessCookie: process.env.JEV_AUDIT_MCP_SMOKE_ACCESS_COOKIE,
        checkToolCall: process.env.JEV_AUDIT_MCP_TOOL_CALL === "1",
      })
    : await runJevAuditRestSmoke({ token: process.env.JEV_AUDIT_SMOKE_TOKEN });
  console.log(JSON.stringify(result, null, 2));
}
