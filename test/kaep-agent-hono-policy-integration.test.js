/** KAEP #85 H1-B: isolated Hono policy integration, deliberately NOT deployed.
 * Fake principal and fake bearer strings are never real authentication.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import app from "../src/index.js";
import { registerRoute } from "../src/middleware/guard.js";
import { fakeKaepGatewayResponse } from "../src/kaep/agent-view-contract.js";

const PATH = "/fixture-only/kaep";
const NOW = Date.parse("2026-10-17T12:00:20Z");
const REPO = "kinoko34077/devflow";
const fixtureToken = "fixture-only-not-an-auth-system";

function projection(recipient = "claude-code") {
  return {
    schema_version: "kaep.agent-current-view.v0.1",
    kind: "SAME_RUN_STRICT_SOURCE_OBSERVATION_NOT_HOSTED",
    status: "PARTIAL_UNKNOWN",
    recipient,
    observed_at: "2026-10-17T12:00:00+00:00",
    observation_age_seconds: 20,
    observation_within_target_age: true,
    freshness_limit_seconds: 60,
    repositories_checked: [REPO],
    source_issues_checked: 0,
    rows: [],
    candidates: [],
    source_errors: [],
    warnings: [{ repository: REPO, reason_code: "RECENT_WINDOW_TRUNCATED" }],
    has_unknown_work: true,
    complete_source_universe: false,
    absence_of_work_proven: false,
    recipient_pickup_proven: false,
    current_head_verified: false,
    can_authorize_execution: false,
    fallback_retirement_authorized: false,
    http_endpoint_deployed: false,
    requires_original_source_recheck_before_action: true,
    read_only: true,
  };
}

function fixtureLimiter(success = true) {
  return { async limit() { return { success }; } };
}

function harness({ fakeProjection = projection(), producerUnavailable = false,
                   authenticatedRecipients = ["claude-code"] } = {}) {
  let producerReads = 0;
  const isolated = new Hono();
  const policy = Object.freeze({
    id: "kaep-fixture-only",
    method: "GET",
    path: PATH,
    preAuthRateLimit: {
      binding: "KAEP_FIXTURE_PREAUTH", keyPrefix: "kaep-fixture-preauth",
      limit: 5, period: 60,
    },
    rateLimit: {
      binding: "KAEP_FIXTURE_RATE", keyPrefix: "kaep-fixture-rate",
      limit: 5, period: 60,
    },
    tokenRateLimit: {
      binding: "KAEP_FIXTURE_TOKEN", keyPrefix: "kaep-fixture-actor",
      key: (c) => c.get("fakePrincipal")?.id,
      limit: 5, period: 60,
    },
    async authenticate(c) {
      if (c.req.header("Authorization") !== "Bearer " + fixtureToken) {
        return c.json({ error: "authentication_required" }, 401);
      }
      c.set("fakePrincipal", Object.freeze({
        id: "fixture-only-actor", verified: true,
        recipients: authenticatedRecipients,
      }));
      return null;
    },
  });
  registerRoute(isolated, "GET", PATH, policy, (c) => {
    const recipient = c.req.query("recipient");
    const principal = c.get("fakePrincipal");
    if (!principal?.recipients.includes(recipient)) {
      return fakeKaepGatewayResponse({
        requestedRecipient: recipient, verifiedPrincipal: principal,
        projected: null, nowMs: NOW,
      });
    }
    producerReads += 1;
    return fakeKaepGatewayResponse({
      requestedRecipient: recipient, verifiedPrincipal: principal,
      projected: fakeProjection, upstreamUnavailable: producerUnavailable,
      nowMs: NOW,
    });
  });
  const env = {
    KAEP_FIXTURE_PREAUTH: fixtureLimiter(),
    KAEP_FIXTURE_RATE: fixtureLimiter(),
    KAEP_FIXTURE_TOKEN: fixtureLimiter(),
  };
  const request = (suffix = "?recipient=claude-code", {
    token = fixtureToken, method = "GET", envOverride = {},
    headers = {},
  } = {}) => isolated.request(
    "https://isolated.invalid" + PATH + suffix, {
      method,
      headers: {
        ...(token === null ? {} : { Authorization: "Bearer " + token }),
        ...headers,
      },
    }, { ...env, ...envOverride },
  );
  return { request, get producerReads() { return producerReads; } };
}

test("isolated Hono accepts scoped fake projection with unknown work", async () => {
  const h = harness();
  const response = await h.request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Authorization");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const body = await response.json();
  assert.equal(body.status, "PARTIAL_UNKNOWN");
  assert.equal(body.has_unknown_work, true);
  assert.equal(body.absence_of_work_proven, false);
  assert.equal(body.can_authorize_execution, false);
  assert.equal(body.http_endpoint_deployed, false);
  assert.equal(h.producerReads, 1);
});

test("401 missing/wrong fake auth blocks all Producer calls", async () => {
  const h = harness();
  for (const token of [null, "wrong"]) {
    const response = await h.request(undefined, { token });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "authentication_required");
  }
  assert.equal(h.producerReads, 0);
});

test("403 recipient mismatch is denied before fake Producer", async () => {
  const h = harness();
  const response = await h.request("?recipient=codex");
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "recipient_forbidden");
  assert.equal(h.producerReads, 0);
});

test("429 all three fake rate blockers preserve no upstream calls", async () => {
  for (const binding of [
    "KAEP_FIXTURE_PREAUTH", "KAEP_FIXTURE_RATE", "KAEP_FIXTURE_TOKEN",
  ]) {
    const h = harness();
    const response = await h.request(undefined, {
      envOverride: { [binding]: fixtureLimiter(false) },
    });
    assert.equal(response.status, 429, binding);
    assert.equal((await response.json()).error, "rate_limited", binding);
    assert.equal(h.producerReads, 0, binding);
  }
});

test("503 missing rate limit binding fails closed without Producer", async () => {
  for (const binding of [
    "KAEP_FIXTURE_PREAUTH", "KAEP_FIXTURE_RATE", "KAEP_FIXTURE_TOKEN",
  ]) {
    const h = harness();
    const response = await h.request(undefined, {
      envOverride: { [binding]: undefined },
    });
    assert.equal(response.status, 503, binding);
    assert.equal((await response.json()).error, "rate_limiter_unavailable", binding);
    assert.equal(h.producerReads, 0, binding);
  }
});

test("503 fake Producer failure and stale data are not success", async () => {
  const broken = harness({ producerUnavailable: true });
  const upstream = await broken.request();
  assert.equal(upstream.status, 503);
  assert.equal((await upstream.json()).error, "source_unavailable");
  assert.equal(broken.producerReads, 1);

  const stale = projection();
  stale.observed_at = "2026-10-17T11:58:00Z";
  stale.observation_age_seconds = 140;
  stale.observation_within_target_age = false;
  const h = harness({ fakeProjection: stale });
  const response = await h.request();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "source_stale");
});

test("fake route does not return ETag or cross-recipient cached responses", async () => {
  const h = harness();
  const response = await h.request(undefined, {
    headers: { "If-None-Match": "\"other-recipient-cache\"" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("etag"), null);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(h.producerReads, 1);
});

test("untrusted extra fields fail closed and never appear in HTTP", async () => {
  const invalid = projection();
  invalid.secret = "do-not-forward-this-test-string";
  const h = harness({ fakeProjection: invalid });
  const response = await h.request();
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /do-not-forward-this-test-string/);
});

test("fake route remains isolated; production API has no KAEP path", async () => {
  const fakeMethod = await harness().request("", { method: "POST" });
  assert.equal(fakeMethod.status, 405);
  const real = await app.request(
    "https://production.invalid/v1/kaep/inbox?recipient=claude-code",
    { method: "GET" }, { GENERAL_RATE_LIMITER: fixtureLimiter() },
  );
  assert.equal(real.status, 404);
});
