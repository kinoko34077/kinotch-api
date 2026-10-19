import test from "node:test";
import assert from "node:assert/strict";
import { fakeKaepGatewayResponse } from "../src/kaep/agent-view-contract.js";

const NOW = Date.parse("2026-10-17T12:00:20Z");
const REPO = "kinoko34077/devflow";
const ISSUE = "https://github.com/kinoko34077/devflow/issues/576";
const PRINCIPAL = { id: "fixture-agent-only", verified: true, recipients: ["claude-code"] };

function fixture() {
  return {
    schema_version: "kaep.agent-current-view.v0.1",
    kind: "SAME_RUN_STRICT_SOURCE_OBSERVATION_NOT_HOSTED",
    status: "PARTIAL_UNKNOWN",
    recipient: "claude-code",
    observed_at: "2026-10-17T12:00:00+00:00",
    observation_age_seconds: 20,
    observation_within_target_age: true,
    freshness_limit_seconds: 60,
    repositories_checked: [REPO],
    source_issues_checked: 1,
    rows: [{
      repository: REPO, issue_number: 576, issue_url: ISSUE,
      source_url: ISSUE + "#issuecomment-912", source_comment_id: 912,
      message_id: "msg_fixture1", recipient: "claude-code",
      issue_state: "open", reply_observation: "PENDING_REPLY",
      source_validation: "STRICT_COMPLETE_FOR_CANDIDATE",
      is_authoritative_assignment: false,
    }],
    candidates: [{
      repository: REPO, issue_number: 576, issue_url: ISSUE,
      matching_recipient_roots: 1,
      source_observation: "ACCEPTED_RECIPIENT_ROOTS",
      candidate_origin: "INDEXED_SOURCE", grants_work_authority: false,
    }],
    source_errors: [{ reason_code: "INVALID_FIELDS", issue_url: ISSUE }],
    warnings: [{ repository: REPO, reason_code: "RECENT_WINDOW_TRUNCATED" }],
    has_unknown_work: true, complete_source_universe: false,
    absence_of_work_proven: false, recipient_pickup_proven: false,
    current_head_verified: false, can_authorize_execution: false,
    fallback_retirement_authorized: false, http_endpoint_deployed: false,
    requires_original_source_recheck_before_action: true,
    read_only: true,
  };
}
function call(overrides = {}) {
  return fakeKaepGatewayResponse({
    requestedRecipient: "claude-code",
    verifiedPrincipal: PRINCIPAL,
    projected: fixture(),
    nowMs: NOW,
    ...overrides,
  });
}

test("valid partial source stays partial, no-cache and never grants authority", async () => {
  const r = call();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.equal(r.headers.get("vary"), "Authorization");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  const body = await r.json();
  assert.equal(body.status, "PARTIAL_UNKNOWN");
  assert.equal(body.rows.length, 1);
  assert.equal(body.source_errors.length, 1);
  assert.equal(body.complete_source_universe, false);
  assert.equal(body.can_authorize_execution, false);
  assert.equal(body.http_endpoint_deployed, false);
  assert.equal(body.recipient_pickup_proven, false);
});

test("anonymous denied without reading service data", async () => {
  const response = call({ verifiedPrincipal: null, projected: { secret: "not returned" } });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required", read_only: true });
});

test("caller/recipient mismatch is 403", async () => {
  const r = call({ requestedRecipient: "codex" });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, "recipient_forbidden");
});

test("rate gate returns 429 and no upstream contents", async () => {
  const r = call({ rateLimited: true });
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("Retry-After"), "60");
  assert.equal((await r.json()).error, "rate_limited");
});

test("upstream missing is 503", async () => {
  const r = call({ upstreamUnavailable: true });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "source_unavailable");
});

test("bounded but empty candidate report is never no-work evidence", async () => {
  const data = fixture();
  data.rows = [];
  data.candidates = [];
  data.source_issues_checked = 0;
  data.source_errors = [];
  const r = call({ projected: data });
  assert.equal(r.status, 200);
  const value = await r.json();
  assert.equal(value.rows.length, 0);
  assert.equal(value.has_unknown_work, true);
  assert.equal(value.absence_of_work_proven, false);
});

test("stale and future projected results fail closed", async () => {
  const old = fixture();
  old.observed_at = "2026-10-17T11:58:00Z";
  old.observation_age_seconds = 140;
  old.observation_within_target_age = false;
  const stale = call({ projected: old });
  assert.equal(stale.status, 503);
  assert.equal((await stale.json()).error, "source_stale");

  const future = fixture();
  future.observed_at = "2026-10-17T12:07:00Z";
  const invalid = call({ projected: future });
  assert.equal(invalid.status, 503);
  assert.equal((await invalid.json()).error, "invalid_source_time");
});

test("producer-declared shorter freshness target is enforced, even below the gateway 60s limit", async () => {
  const source = fixture(); // observation is 20 seconds old
  source.freshness_limit_seconds = 10;
  source.observation_within_target_age = false;
  const r = call({ projected: source });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "source_stale");

  // Even a maliciously or incorrectly marked "fresh" report cannot bypass
  // the age measurement made at the receiving gateway.
  source.observation_within_target_age = true;
  const forged = call({ projected: source });
  assert.equal(forged.status, 503);
  assert.equal((await forged.json()).error, "source_stale");

  source.freshness_limit_seconds = 20;
  const exactly = call({ projected: source });
  assert.equal(exactly.status, 200);
  assert.equal((await exactly.json()).status, "PARTIAL_UNKNOWN");
});

test("slightly future-dated or timezone-ambiguous timestamps never count as fresh", async () => {
  const badTimes = [
    "2026-10-17T12:00:21Z", // 1 sec into future (old code tolerated 5 minutes)
    "2026-10-17T12:00:30+00:00",
    "2026-10-17T12:00:00", // lacks a timezone offset
    "2026-10-17 12:00:00Z", // non-canonical separator
    "2026-10-17T12:00:00+0000", // timezone offset not ISO canonical
  ];
  for (const observed_at of badTimes) {
    const source = fixture();
    source.observed_at = observed_at;
    source.observation_age_seconds = 0;
    const r = call({ projected: source });
    assert.equal(r.status, 503, observed_at);
    assert.equal((await r.json()).error, "invalid_source_time", observed_at);
  }
});

test("UTC Z and explicit +09:00 timestamps are accepted when observation is actually fresh", async () => {
  for (const observed_at of ["2026-10-17T12:00:00Z", "2026-10-17T21:00:00+09:00"]) {
    const source = fixture();
    source.observed_at = observed_at;
    assert.equal(call({ projected: source }).status, 200, observed_at);
  }
});

test("untrusted extra payload, bogus authority and forged URL are never served", async () => {
  const cases = [
    (x) => { x.rows[0].secret = "sk-sensitive-example"; },
    (x) => { x.can_authorize_execution = true; },
    (x) => { x.source_errors[0].issue_url = "https://evil.example/"; },
    (x) => { x.rows[0].source_url = ISSUE + "#issuecomment-913"; },
    (x) => { x.candidates[0].issue_url = "https://evil.example/"; },
    (x) => { x.candidates[0].matching_recipient_roots = 0; },
    (x) => { x.rows[0].recipient = "codex"; },
    (x) => { x.repositories_checked = [REPO, REPO]; },
    (x) => { x.rows.push({ ...x.rows[0] }); },
  ];
  for (const bad of cases) {
    const data = fixture();
    bad(data);
    const res = call({ projected: data });
    assert.equal(res.status, 503);
    const text = await res.text();
    assert.equal(text.includes("sk-sensitive-example"), false);
    assert.equal(text.includes("evil.example"), false);
  }
});

test("wrong/partial source fields and oversize payload fail closed", async () => {
  const unknown = fixture();
  unknown.status = "BLOCKED";
  assert.equal(call({ projected: unknown }).status, 503);
  const oversized = fixture();
  oversized.payload = "X".repeat(263_000);
  assert.equal(call({ projected: oversized }).status, 503);
});

test("no deployed HTTP route is registered by importing this adapter", async () => {
  const { apiRoutes } = await import("../src/routes/api.js");
  const paths = apiRoutes.routes.map((r) => r.path);
  assert.equal(paths.some((p) => p.includes("/kaep/")), false);
});
