import { AUDIT_SEMANTICS_VERSION, AUDIT_PROFILES } from "../jev-audit/contract.js";

const VALID_STATUS = new Set(["clear", "review", "rework", "unknown"]);

export class JevAuditMcpError extends Error {
  constructor(code, status = 500) {
    super(code);
    this.name = "JevAuditMcpError";
    this.code = code;
    this.status = status;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isValidAuditPayload(value, input) {
  const expectedProfile = input.profile ?? "development";
  return isPlainObject(value)
    && value.profile === expectedProfile
    && isSafeCount(value.files_scanned)
    && value.files_scanned === input.files.length
    && isSafeCount(value.batches)
    && value.batches >= 1
    && isPlainObject(value.aggregate)
    && isPlainObject(value.aggregate.overall)
    && VALID_STATUS.has(value.aggregate.overall.status)
    && Array.isArray(value.truncated_paths)
    && isPlainObject(value.coverage)
    && isPlainObject(value.provenance)
    && value.provenance.audit_semantics_version === AUDIT_SEMANTICS_VERSION
    && value.provenance.profile_name === expectedProfile
    && typeof value.provenance.resolved_model === "string"
    && value.provenance.resolved_model.length > 0;
}

function mapStatus(status) {
  if (status === 400) return new JevAuditMcpError("invalid_input", 400);
  if (status === 413) return new JevAuditMcpError("payload_too_large", 413);
  if (status === 429) return new JevAuditMcpError("rate_limited", 429);
  if (status === 503 || status === 504) return new JevAuditMcpError("audit_unavailable", status);
  if (status >= 500) return new JevAuditMcpError("audit_unavailable", 502);
  return new JevAuditMcpError("invalid_upstream_response", 502);
}

export async function callJevAuditService(env, input, { timeoutMs = 50_000 } = {}) {
  const service = env?.JEV_AUDIT;
  if (!service || typeof service.fetch !== "function") {
    throw new JevAuditMcpError("audit_unavailable", 503);
  }
  if (!isPlainObject(input) || !Array.isArray(input.files) || !Object.hasOwn(AUDIT_PROFILES, input.profile ?? "development")) {
    throw new JevAuditMcpError("invalid_input", 400);
  }

  const controller = typeof AbortController === "function" && timeoutMs > 0 ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await service.fetch(new Request("https://jev-audit.internal/v1/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      ...(controller ? { signal: controller.signal } : {}),
    }));
    if (response.status !== 200) throw mapStatus(response.status);

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new JevAuditMcpError("invalid_upstream_response", 502);
    }
    if (!isValidAuditPayload(payload, input)) {
      throw new JevAuditMcpError("invalid_upstream_response", 502);
    }
    return payload;
  } catch (error) {
    if (error instanceof JevAuditMcpError) throw error;
    if (error?.name === "AbortError") throw new JevAuditMcpError("audit_timeout", 504);
    throw new JevAuditMcpError("audit_unavailable", 502);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
