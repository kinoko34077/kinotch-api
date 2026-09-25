import { REMOTE_AUDIT_LIMITS } from "../jev-audit/contract.js";

export const JEV_AUDIT_MCP_BODY_LIMIT_BYTES = REMOTE_AUDIT_LIMITS.maxRequestBytes;

function hasOversizedContentLength(request, limitBytes) {
  const raw = request.headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw.trim())) return false;
  const value = Number(raw);
  return !Number.isSafeInteger(value) || value > limitBytes;
}

export async function inspectJevAuditMcpBodyLimit(request, limitBytes = JEV_AUDIT_MCP_BODY_LIMIT_BYTES) {
  if (hasOversizedContentLength(request, limitBytes)) {
    return { ok: false, code: "payload_too_large" };
  }
  if (!request.body) return { ok: true };

  try {
    const reader = request.clone().body?.getReader();
    if (!reader) return { ok: true };
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > limitBytes) {
        reader.cancel().catch(() => {});
        return { ok: false, code: "payload_too_large" };
      }
    }
  } catch {
    return { ok: false, code: "invalid_body" };
  }
  return { ok: true };
}
