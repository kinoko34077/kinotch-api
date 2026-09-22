import { createRemoteJWKSet, jwtVerify } from "jose";

function normalizeTeamDomain(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const candidate = value.trim().startsWith("http") ? value.trim() : `https://${value.trim()}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" && url.pathname !== "") return null;
  return url.origin;
}

export async function verifyAccessJwt(request, env, {
  createRemoteJWKSetImpl = createRemoteJWKSet,
  jwtVerifyImpl = jwtVerify,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { ok: false, code: "authentication_failed" };

  const issuer = normalizeTeamDomain(env?.TEAM_DOMAIN);
  if (!issuer || typeof env?.POLICY_AUD !== "string" || env.POLICY_AUD.trim().length === 0) {
    return { ok: false, code: "authentication_unavailable" };
  }

  try {
    const jwks = createRemoteJWKSetImpl(new URL(`${issuer}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerifyImpl(token, jwks, {
      issuer,
      audience: env.POLICY_AUD,
    });
    if (!Number.isSafeInteger(payload?.exp) || payload.exp <= now()) {
      return { ok: false, code: "authentication_failed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: "authentication_failed" };
  }
}
