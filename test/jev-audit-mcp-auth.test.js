import test from "node:test";
import assert from "node:assert/strict";
import { verifyAccessJwt } from "../src/jev-audit-mcp/access-auth.js";

function requestWithToken(token = "fixture-access-jwt") {
  const headers = token === null ? undefined : { "Cf-Access-Jwt-Assertion": token };
  return new Request("https://jev-audit-mcp.example.test/mcp", { headers });
}

function authOptions(result = { payload: { exp: Math.floor(Date.now() / 1000) + 60 } }) {
  return {
    createRemoteJWKSetImpl: (url) => {
      assert.equal(url.toString(), "https://team.example.com/cdn-cgi/access/certs");
      return { fixtureJwks: true };
    },
    jwtVerifyImpl: async (_token, jwks, options) => {
      assert.deepEqual(jwks, { fixtureJwks: true });
      assert.deepEqual(options, { issuer: "https://team.example.com", audience: "audience-tag" });
      return result;
    },
  };
}

test("Jev MCP Access JWT without actor claims authenticates without actorKey", async () => {
  const result = await verifyAccessJwt(requestWithToken(), {
    TEAM_DOMAIN: "team.example.com",
    POLICY_AUD: "audience-tag",
  }, authOptions());
  assert.deepEqual(result, { ok: true });
});
test("Jev MCP Access JWKS resolver is reused for the same issuer", async () => {
  let factoryCalls = 0;
  const createRemoteJWKSetImpl = (url) => {
    factoryCalls += 1;
    assert.equal(url.toString(), "https://team.example.com/cdn-cgi/access/certs");
    return { fixtureJwks: factoryCalls };
  };
  const seenJwks = [];
  const jwtVerifyImpl = async (_token, jwks) => {
    seenJwks.push(jwks);
    return { payload: { exp: Math.floor(Date.now() / 1000) + 60 } };
  };
  const env = { TEAM_DOMAIN: "team.example.com", POLICY_AUD: "audience-tag" };

  assert.deepEqual(await verifyAccessJwt(requestWithToken("one"), env, { createRemoteJWKSetImpl, jwtVerifyImpl }), { ok: true });
  assert.deepEqual(await verifyAccessJwt(requestWithToken("two"), env, { createRemoteJWKSetImpl, jwtVerifyImpl }), { ok: true });
  assert.equal(factoryCalls, 1);
  assert.equal(seenJwks.length, 2);
  assert.equal(seenJwks[0], seenJwks[1]);
});
