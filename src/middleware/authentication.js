const bearerPattern = /^Bearer ([^\s]+)$/i;
const textEncoder = new TextEncoder();

async function sha256Fingerprint(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") throw new Error("Web Crypto is unavailable");
  const digest = await subtle.digest("SHA-256", textEncoder.encode(value));
  return new Uint8Array(digest);
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function errorResponse(c, status, code, message) {
  const requestId = c.get("requestId");
  return c.json({
    error: code,
    message,
    ...(requestId ? { requestId } : {}),
  }, status);
}

export async function authenticateCompression(c) {
  const expectedToken = c.env?.COMPRESSION_API_TOKEN;
  if (typeof expectedToken !== "string" || expectedToken.length === 0) {
    return errorResponse(c, 503, "authentication_unavailable", "Compression authentication is unavailable");
  }

  const authorization = c.req.header("Authorization") ?? "";
  const match = bearerPattern.exec(authorization);
  if (!match) {
    return errorResponse(c, 401, "authentication_failed", "Compression authentication failed");
  }

  try {
    const [presentedFingerprint, expectedFingerprint] = await Promise.all([
      sha256Fingerprint(match[1]),
      sha256Fingerprint(expectedToken),
    ]);
    if (!timingSafeEqual(presentedFingerprint, expectedFingerprint)) {
      return errorResponse(c, 401, "authentication_failed", "Compression authentication failed");
    }
  } catch {
    return errorResponse(c, 503, "authentication_unavailable", "Compression authentication is unavailable");
  }
  return null;
}
