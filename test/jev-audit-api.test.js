import assert from "node:assert/strict";
import test from "node:test";

import app from "../src/index.js";
import { routePolicies } from "../src/policies/routes.js";

const TOKEN = "<fixture-jev-audit-token>";
const validBody = { files: [{ path: "src/app.py", content: "print(1)" }], profile: "development" };

function allowRateLimiter() {
  return { limit() { return Promise.resolve({ success: true }); } };
}

function requestInit(body, token = TOKEN) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  };
}

function auditResponse(body = { profile: "development", files_scanned: 1, batches: 1 }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function env(overrides = {}) {
  return {
    JEV_AUDIT_API_TOKEN: TOKEN,
    JEV_AUDIT_PREAUTH_RATE_LIMITER: allowRateLimiter(),
    JEV_AUDIT_RATE_LIMITER: allowRateLimiter(),
    JEV_AUDIT_TOKEN_RATE_LIMITER: allowRateLimiter(),
    JEV_AUDIT: { fetch() { return Promise.resolve(auditResponse()); } },
    ...overrides,
  };
}

test("jev-audit REST policy is isolated and bounded", () => {
  const policy = routePolicies.jevAudit;
  assert.equal(policy.id, "jev-audit");
  assert.equal(policy.path, "/v1/audit");
  assert.equal(policy.method, "POST");
  assert.equal(policy.bodyLimitBytes, 1024 * 1024);
  assert.deepEqual(policy.preAuthRateLimit, {
    binding: "JEV_AUDIT_PREAUTH_RATE_LIMITER",
    keyPrefix: "jev-audit-preauth",
    limit: 5,
    period: 60,
  });
  assert.deepEqual(policy.rateLimit, {
    binding: "JEV_AUDIT_RATE_LIMITER",
    keyPrefix: "jev-audit",
    limit: 5,
    period: 60,
  });
  assert.equal(policy.tokenRateLimit.binding, "JEV_AUDIT_TOKEN_RATE_LIMITER");
  assert.equal(policy.upstreamTimeoutMs, 50_000);
});

test("jev-audit REST rejects missing and wrong bearer tokens before binding", async () => {
  let upstreamCalls = 0;
  const auditEnv = env({ JEV_AUDIT: { fetch() { upstreamCalls += 1; return Promise.resolve(auditResponse()); } } });

  const missing = await app.request("https://api.test/v1/audit", requestInit(validBody, null), auditEnv);
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).error, "authentication_failed");

  const wrong = await app.request("https://api.test/v1/audit", requestInit(validBody, "wrong"), auditEnv);
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error, "authentication_failed");
  assert.equal(upstreamCalls, 0);
});

test("jev-audit REST rejects invalid snapshots before Service Binding", async () => {
  let upstreamCalls = 0;
  const response = await app.request(
    "https://api.test/v1/audit",
    requestInit({ files: [], changed_only: true }),
    env({ JEV_AUDIT: { fetch() { upstreamCalls += 1; return Promise.resolve(auditResponse()); } } }),
  );

  assert.equal(response.status, 400);
  assert.equal(upstreamCalls, 0);
});

test("jev-audit REST token limiter uses a non-reversible audit token fingerprint", async () => {
  let tokenKey;
  const response = await app.request(
    "https://api.test/v1/audit",
    requestInit(validBody),
    env({
      JEV_AUDIT_TOKEN_RATE_LIMITER: {
        limit(input) { tokenKey = input.key; return Promise.resolve({ success: true }); },
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.match(tokenKey, /^jev-audit-auth:[0-9a-f]{64}$/);
  assert.doesNotMatch(tokenKey, new RegExp(TOKEN));
});

test("jev-audit REST forwards only JSON audit data to the private binding", async () => {
  let upstreamRequest;
  const response = await app.request(
    "https://api.test/v1/audit",
    requestInit(validBody),
    env({
      JEV_AUDIT: {
        async fetch(request) {
          upstreamRequest = request;
          return auditResponse({ ok: true });
        },
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(upstreamRequest.method, "POST");
  assert.equal(upstreamRequest.headers.get("authorization"), null);
  assert.equal(upstreamRequest.headers.get("content-type"), "application/json");
  assert.deepEqual(await upstreamRequest.json(), validBody);
});

test("jev-audit REST fails closed when its authentication secret is absent", async () => {
  let upstreamCalls = 0;
  const response = await app.request(
    "https://api.test/v1/audit",
    requestInit(validBody),
    env({
      JEV_AUDIT_API_TOKEN: undefined,
      JEV_AUDIT: { fetch() { upstreamCalls += 1; return Promise.resolve(auditResponse()); } },
    }),
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "authentication_unavailable");
  assert.equal(upstreamCalls, 0);
});
