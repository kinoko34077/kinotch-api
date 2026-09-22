import test from "node:test";
import assert from "node:assert/strict";
import { verifyAccessJwt } from "../src/semantic-compression-mcp/access-auth.js";

function requestWithToken(token = "fixture-access-jwt") {
  const headers = token === null ? undefined : { "Cf-Access-Jwt-Assertion": token };
  return new Request("https://mcp.example.test/mcp", { headers });
}

function authOptions(result = { payload: { exp: Math.floor(Date.now() / 1000) + 60 } }) {
  return {
    createRemoteJWKSetImpl: (url) => {
      assert.equal(url.toString(), "https://team.example.com/cdn-cgi/access/certs");
      return { fixtureJwks: true };
    },
    jwtVerifyImpl: async (_token, jwks, options) => {
      assert.deepEqual(jwks, { fixtureJwks: true });
      assert.deepEqual(options, {
        issuer: "https://team.example.com",
        audience: "audience-tag",
      });
      return result;
    },
  };
}

test("missing Access JWT fails closed before dispatch", async () => {
  const result = await verifyAccessJwt(requestWithToken(null), {
    TEAM_DOMAIN: "team.example.com",
    POLICY_AUD: "audience-tag",
  }, authOptions());

  assert.deepEqual(result, { ok: false, code: "authentication_failed" });
});

test("missing Access configuration is unavailable, not authenticated", async () => {
  const result = await verifyAccessJwt(requestWithToken(), {}, authOptions());

  assert.deepEqual(result, { ok: false, code: "authentication_unavailable" });
});

test("JWT verifier receives normalized issuer and audience and returns no claims", async () => {
  const result = await verifyAccessJwt(requestWithToken(), {
    TEAM_DOMAIN: "https://team.example.com/",
    POLICY_AUD: "audience-tag",
  }, authOptions());

  assert.deepEqual(result, { ok: true });
});

test("invalid issuer, audience, signature, or expiry becomes authentication_failed", async (t) => {
  for (const [name, verifier] of [
    ["issuer", async () => { throw new Error("issuer mismatch"); }],
    ["audience", async () => { throw new Error("audience mismatch"); }],
    ["signature", async () => { throw new Error("signature mismatch"); }],
    ["expiry", async () => ({ payload: { exp: Math.floor(Date.now() / 1000) - 1 } })],
  ]) {
    await t.test(name, async () => {
      const result = await verifyAccessJwt(requestWithToken(), {
        TEAM_DOMAIN: "team.example.com",
        POLICY_AUD: "audience-tag",
      }, {
        ...authOptions(),
        jwtVerifyImpl: verifier,
      });
      assert.deepEqual(result, { ok: false, code: "authentication_failed" });
    });
  }
});
