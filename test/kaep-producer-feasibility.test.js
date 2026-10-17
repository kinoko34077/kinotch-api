import test from "node:test";
import assert from "node:assert/strict";
import {
  assessKaepPollingFeasibility,
  KAEP_PRODUCER_REFERENCE_LIMITS,
} from "../src/kaep/producer-feasibility.js";

const publicFleet = {
  host: "public_worker_unauthenticated",
  publicRepositories: 40,
  historicalBaselineRequests: 129,
  refreshSeconds: 60,
};

test("accepted all-public baseline 129 exceeds one Free Worker 50-external request envelope", () => {
  const d = assessKaepPollingFeasibility(publicFleet);
  assert.equal(d.schema_version, "kaep.producer-feasibility.v0.1");
  assert.equal(d.first_full_sweep_needs_multiple_worker_invocations, true);
  assert.equal(d.reference_free_worker_external_subrequests, 50);
  assert.equal(d.can_authorize_deployment, false);
  assert.equal(d.http_endpoint_deployed, false);
});

test("minute-level 40 public repo polling exceeds unauthenticated GitHub primary 60/hour, even before Issue GET", () => {
  const d = assessKaepPollingFeasibility(publicFleet);
  assert.equal(d.estimated_scans_per_hour, 60);
  assert.equal(d.minimum_get_per_scan, 41); // 1 owner repo listing + 40 latest comment GETs
  assert.equal(d.minimum_get_per_hour, 2460);
  assert.equal(d.unauthenticated_github_budget_exceeded, true);
  assert.ok(d.reasons.includes("UNAUTHENTICATED_GITHUB_REST_LOWER_BOUND_EXCEEDS_REFERENCE_LIMIT"));
  assert.ok(d.reasons.includes("PUBLIC_HTTP_CALLER_NOT_AUTHENTICATED"));
  assert.equal(d.source_provenance_verified, false);
  assert.equal(d.automatic_trigger_verified, false);
});

test("five-minute repeat polling still exceeds unauthenticated GitHub limit", () => {
  const d = assessKaepPollingFeasibility({ ...publicFleet, refreshSeconds: 300 });
  assert.equal(d.minimum_get_per_hour, 492);
  assert.equal(d.target_freshness_unachievable_from_cadence, true);
  assert.equal(d.admission, "HOLD_H3_HOST_IDENTITY_AND_SOURCE_PROOF");
});

test("slower cadence below limit still does not prove freshness or authorize service", () => {
  const d = assessKaepPollingFeasibility({ ...publicFleet, refreshSeconds: 3600 });
  assert.equal(d.minimum_get_per_hour, 41);
  assert.equal(d.unauthenticated_github_budget_exceeded, false);
  assert.equal(d.target_freshness_unachievable_from_cadence, true);
  assert.equal(d.can_authorize_execution, false);
  assert.equal(d.host_identity_verified, false);
  assert.equal(d.real_provider_or_cloudflare_cost_verified, false);
});

test("owner-PC accepted one-shot source GET is not an unattended authenticated producer", () => {
  const d = assessKaepPollingFeasibility({ ...publicFleet, host: "owner_pc_one_shot" });
  assert.ok(d.reasons.includes("ONE_SHOT_OWNER_PC_IS_NOT_UNATTENDED_HOST"));
  assert.equal(d.host_identity_verified, false);
  assert.equal(d.can_grant_recipient_claim, false);
});

test("GitHub Actions event-runner and GitHub App Broker remain Human/security gated", () => {
  for (const host of ["github_actions_event", "github_app_broker"]) {
    const d = assessKaepPollingFeasibility({ ...publicFleet, host });
    assert.equal(d.admission, "HOLD_H3_HOST_IDENTITY_AND_SOURCE_PROOF");
    assert.equal(d.automatic_trigger_verified, false);
    assert.equal(d.can_authorize_deployment, false);
    assert.ok(d.reasons.length >= 2);
  }
});

test("injected high API reference budget cannot turn arithmetic into authorization", () => {
  const d = assessKaepPollingFeasibility({
    ...publicFleet, githubUnauthenticatedRestRequestsPerHour: 1_000_000,
    workerExternalSubrequestsPerInvocation: 1_000_000,
  });
  assert.equal(d.unauthenticated_github_budget_exceeded, false);
  assert.equal(d.first_full_sweep_needs_multiple_worker_invocations, false);
  assert.equal(d.admission, "HOLD_H3_HOST_IDENTITY_AND_SOURCE_PROOF");
  assert.equal(d.can_authorize_deployment, false);
});

test("reject malformed inputs instead of interpreting negative, NaN, string or unsafe costs", () => {
  const examples = [
    { publicRepositories: 0 },
    { publicRepositories: "40" },
    { refreshSeconds: 0 },
    { refreshSeconds: Infinity },
    { historicalBaselineRequests: -1 },
    { historicalBaselineRequests: 4.5 },
    { workerExternalSubrequestsPerInvocation: 0 },
    { host: "unrestricted_internet_proxy" },
    { maxObservationAgeSeconds: -1 },
  ];
  for (const change of examples) {
    assert.throws(() => assessKaepPollingFeasibility({ ...publicFleet, ...change }),
      /INVALID_KAEP_PRODUCER_ASSUMPTIONS/);
  }
});

test("diagnostic result is fixed allowlist and includes no credential/host token/value", () => {
  const output = JSON.stringify(assessKaepPollingFeasibility(publicFleet));
  assert.equal(output.includes("authorization"), false);
  assert.equal(output.includes("api_key"), false);
  assert.equal(output.includes("secret"), false);
  assert.equal(KAEP_PRODUCER_REFERENCE_LIMITS.targetObservationAgeSeconds, 60);
});
