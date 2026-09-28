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

test("JWT verification returns only a non-reversible actor fingerprint", async () => {
  const result = await verifyAccessJwt(requestWithToken(), {
    TEAM_DOMAIN: "https://team.example.com/",
    POLICY_AUD: "audience-tag",
  }, authOptions({
    payload: { sub: "operator@example.test", exp: Math.floor(Date.now() / 1000) + 60 },
  }));

  assert.equal(result.ok, true);
  assert.match(result.actorKey, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(result.actorKey, /operator|example/);
});

test("Semantic Compression MCP Access JWKS resolver is reused for the same issuer and factory", async () => {
  let factoryCalls = 0;
  const seenJwks = [];
  const createRemoteJWKSetImpl = (url) => {
    factoryCalls += 1;
    assert.equal(url.toString(), "https://team.example.com/cdn-cgi/access/certs");
    return { fixtureJwks: factoryCalls };
  };
  const jwtVerifyImpl = async (_token, jwks) => {
    seenJwks.push(jwks);
    return { payload: { exp: Math.floor(Date.now() / 1000) + 60 } };
  };
  const env = { TEAM_DOMAIN: "team.example.com", POLICY_AUD: "audience-tag" };
  const options = { createRemoteJWKSetImpl, jwtVerifyImpl };

  assert.deepEqual(await verifyAccessJwt(requestWithToken("one"), env, options), { ok: true });
  assert.deepEqual(await verifyAccessJwt(requestWithToken("two"), env, options), { ok: true });
  assert.equal(factoryCalls, 1);
  assert.equal(seenJwks.length, 2);
  assert.equal(seenJwks[0], seenJwks[1]);
});

test("Semantic Compression MCP Access JWKS cache isolates issuers", async () => {
  const created = [];
  const createRemoteJWKSetImpl = (url) => {
    const jwks = { url: url.toString() };
    created.push(jwks);
    return jwks;
  };
  const seenJwks = [];
  const jwtVerifyImpl = async (_token, jwks) => {
    seenJwks.push(jwks);
    return { payload: { exp: Math.floor(Date.now() / 1000) + 60 } };
  };
  const options = { createRemoteJWKSetImpl, jwtVerifyImpl };

  assert.deepEqual(await verifyAccessJwt(requestWithToken("team"), {
    TEAM_DOMAIN: "team.example.com",
    POLICY_AUD: "audience-tag",
  }, options), { ok: true });
  assert.deepEqual(await verifyAccessJwt(requestWithToken("other"), {
    TEAM_DOMAIN: "other.example.com",
    POLICY_AUD: "audience-tag",
  }, options), { ok: true });

  assert.equal(created.length, 2);
  assert.notEqual(seenJwks[0], seenJwks[1]);
  assert.equal(seenJwks[0].url, "https://team.example.com/cdn-cgi/access/certs");
  assert.equal(seenJwks[1].url, "https://other.example.com/cdn-cgi/access/certs");
});

test("Semantic Compression MCP Access JWKS cache isolates injected factories", async () => {
  let firstFactoryCalls = 0;
  let secondFactoryCalls = 0;
  const firstJwks = { factory: "first" };
  const secondJwks = { factory: "second" };
  const firstFactory = () => {
    firstFactoryCalls += 1;
    return firstJwks;
  };
  const secondFactory = () => {
    secondFactoryCalls += 1;
    return secondJwks;
  };
  const seenJwks = [];
  const jwtVerifyImpl = async (_token, jwks) => {
    seenJwks.push(jwks);
    return { payload: { exp: Math.floor(Date.now() / 1000) + 60 } };
  };
  const env = { TEAM_DOMAIN: "team.example.com", POLICY_AUD: "audience-tag" };

  assert.deepEqual(await verifyAccessJwt(requestWithToken("first"), env, {
    createRemoteJWKSetImpl: firstFactory,
    jwtVerifyImpl,
  }), { ok: true });
  assert.deepEqual(await verifyAccessJwt(requestWithToken("second"), env, {
    createRemoteJWKSetImpl: secondFactory,
    jwtVerifyImpl,
  }), { ok: true });
  assert.deepEqual(await verifyAccessJwt(requestWithToken("first-again"), env, {
    createRemoteJWKSetImpl: firstFactory,
    jwtVerifyImpl,
  }), { ok: true });

  assert.equal(firstFactoryCalls, 1);
  assert.equal(secondFactoryCalls, 1);
  assert.deepEqual(seenJwks, [firstJwks, secondJwks, firstJwks]);
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
