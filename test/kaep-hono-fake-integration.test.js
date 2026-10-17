import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { registerRoute } from "../src/middleware/guard.js";
import { fakeKaepGatewayResponse } from "../src/kaep/agent-view-contract.js";

const PATH = "/__test_only__/kaep/inbox";
const NOW = Date.parse("2026-10-17T12:00:20Z");
const RECIPIENT = "claude-code";

function observed() {
  return {
    schema_version: "kaep.agent-current-view.v0.1",
    kind: "SAME_RUN_STRICT_SOURCE_OBSERVATION_NOT_HOSTED",
    status: "PARTIAL_UNKNOWN", recipient: RECIPIENT,
    observed_at: "2026-10-17T12:00:00Z",
    observation_age_seconds: 20, observation_within_target_age: true,
    freshness_limit_seconds: 60,
    repositories_checked: ["kinoko34077/devflow"],
    source_issues_checked: 0, rows: [], candidates: [],
    source_errors: [], warnings: [],
    has_unknown_work: true, complete_source_universe: false,
    absence_of_work_proven: false, recipient_pickup_proven: false,
    current_head_verified: false, can_authorize_execution: false,
    fallback_retirement_authorized: false, http_endpoint_deployed: false,
    requires_original_source_recheck_before_action: true, read_only: true,
  };
}
function makeApp() {
  const app = new Hono();
  // Entire router/policy is created only in this test module; it is never
  // imported or registered into src/index.js or production src/routes/api.js.
  const fakePolicy = {
    id: "kaep-test-only", method: "GET", path: PATH,
    rateLimit: { binding: "KAEP_FAKE_RATE_LIMITER", limit: 2, period: 60 },
    authenticate: async (c) => {
      // The fixture header is deliberately fake; never use as real auth.
      if (c.req.header("x-test-fixture-agent") !== "caller-1") {
        return c.json({ error: "authentication_required" }, 401);
      }
      c.set("fixturePrincipal", {
        verified: true, id: "caller-1", recipients: [RECIPIENT],
      });
      return null;
    },
  };
  registerRoute(app, "GET", PATH, fakePolicy, (c) => {
    const source = c.env?.FAKE_KAEP_PRODUCER?.();
    return fakeKaepGatewayResponse({
      requestedRecipient: c.req.query("recipient"),
      verifiedPrincipal: c.get("fixturePrincipal"),
      projected: source,
      nowMs: NOW,
    });
  });
  return app;
}
function env({ success = true, producer = observed, limiter = true } = {}) {
  return {
    ...(limiter ? {
      KAEP_FAKE_RATE_LIMITER: {
        limit: () => Promise.resolve({ success }),
      },
    } : {}),
    FAKE_KAEP_PRODUCER: producer,
  };
}
function url() { return "https://fixture.invalid" + PATH + "?recipient=" + RECIPIENT; }
function request(app, envValue, { agent = true, method = "GET", recipient = RECIPIENT } = {}) {
  return app.request("https://fixture.invalid" + PATH + "?recipient=" + recipient, {
    method, headers: agent ? { "x-test-fixture-agent": "caller-1" } : {},
  }, envValue);
}

test("isolated existing Hono policy + fake adapter carries partial, bounded status", async () => {
  const app = makeApp();
  const result = await request(app, env());
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.status, "PARTIAL_UNKNOWN");
  assert.equal(data.has_unknown_work, true);
  assert.equal(data.absence_of_work_proven, false);
  assert.equal(data.http_endpoint_deployed, false);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.equal(result.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(app.routes.some((route) => route.path === PATH), true);
});

test("fake authenticated caller must pass middleware before Producer read", async () => {
  let invoked = 0;
  const r = await request(makeApp(), env({ producer: () => {
    invoked += 1; return observed();
  } }), { agent: false });
  assert.equal(r.status, 401);
  assert.equal(invoked, 0);
});

test("fixture recipient mismatch is denied even for admitted fake caller", async () => {
  const r = await request(makeApp(), env(), { recipient: "codex" });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, "recipient_forbidden");
});

test("existing Hono rate limiter yields 429 before Producer when exhausted", async () => {
  let called = 0;
  const r = await request(makeApp(), env({
    success: false, producer: () => { called++; return observed(); },
  }));
  assert.equal(r.status, 429);
  assert.equal((await r.json()).error, "rate_limited");
  assert.equal(r.headers.get("retry-after"), "60");
  assert.equal(called, 0);
});

test("missing existing Gateway rate limit binding fails closed to 503", async () => {
  let called = 0;
  const r = await request(makeApp(), env({
    limiter: false, producer: () => { called++; return observed(); },
  }));
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "rate_limiter_unavailable");
  assert.equal(called, 0);
});

test("missing Producer and stale Producer never become accepted current inbox", async () => {
  const missing = await request(makeApp(), env({ producer: () => null }));
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error, "source_unavailable");
  const old = observed();
  old.observed_at = "2026-10-17T11:54:00Z";
  old.observation_age_seconds = 380;
  old.observation_within_target_age = false;
  const stale = await request(makeApp(), env({ producer: () => old }));
  assert.equal(stale.status, 503);
  assert.equal((await stale.json()).error, "source_stale");
});

test("existing Hono registerRoute enforces GET only", async () => {
  const r = await request(makeApp(), env(), { method: "POST" });
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "GET");
});

test("production Hono routes remain unmodified/unregistered", async () => {
  const real = (await import("../src/index.js")).default;
  const routes = real.routes ?? [];
  assert.equal(routes.some((r) => r.path.includes("/kaep")), false);
  assert.equal(routes.some((r) => r.path === PATH), false);
});
