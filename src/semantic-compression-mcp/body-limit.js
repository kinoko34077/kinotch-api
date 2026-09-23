import { COMPRESSION_BODY_LIMIT_BYTES } from "../semantic-compression/contract.js";

export const MCP_TRANSPORT_BODY_LIMIT_BYTES = COMPRESSION_BODY_LIMIT_BYTES;

function hasOversizedContentLength(request, limitBytes) {
  const rawContentLength = request.headers.get("content-length");
  if (rawContentLength === null || !/^\d+$/.test(rawContentLength.trim())) return false;
  const contentLength = Number(rawContentLength);
  return !Number.isSafeInteger(contentLength) || contentLength > limitBytes;
}

export async function inspectMcpBodyLimit(
  request,
  limitBytes = MCP_TRANSPORT_BODY_LIMIT_BYTES,
) {
  if (hasOversizedContentLength(request, limitBytes)) {
    return { ok: false, code: "payload_too_large" };
  }

  if (!request.body) return { ok: true };

  try {
    const reader = request.clone().body?.getReader();
    if (!reader) return { ok: true };

    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > limitBytes) {
        reader.cancel().catch(() => {});
        return { ok: false, code: "payload_too_large" };
      }
    }
  } catch {
    return { ok: false, code: "invalid_body" };
  }

  return { ok: true };
}
