import assert from "node:assert/strict";
import test from "node:test";

import {
  BENCHMARK_FIXTURES,
  runRemoteBenchmark,
  scoreBenchmarkFixture,
} from "../src/jev-audit/benchmark.js";
import {
  buildHistoryEvent,
  normalizeBenchmarkState,
  rollingMean,
} from "../src/jev-audit/history.js";
import { recordRemoteAudit } from "../src/jev-audit/observability.js";

const EXPECTED_IDS = [
  "clear-code",
  "concrete-issue",
  "spec-mismatch",
  "regression-risk",
  "insufficient-context",
  "strong-rework",
  "benign-config-docs",
  "mild-review",
];

function report(marker = "PRIVATE_SOURCE_MARKER") {
  return {
    profile: "development",
    files_scanned: 2,
    batches: 1,
    aggregate: {
      overall: { status: "review", risk: 0.63, status_trigger: null },
      usage: {
        input_tokens: 41,
        output_tokens: 7,
        input_tokens_complete: true,
        output_tokens_complete: true,
      },
      total_batch_latency_ms: 12,
      highest_risk_batches: [{ paths: [`src/${marker}.js`] }],
    },
    truncated_paths: [`src/${marker}.js`],
    coverage: { submitted_files: 2, audited_files: 2, truncated_files: 1 },
    provenance: {
      service_version: "remote-v1",
      audit_semantics_version: "0.2.12",
      resolved_model: "jev-1.13.0",
      profile_name: "development",
      batch_count: 1,
    },
  };
}

test("remote benchmark fixture ids stay aligned with Local", () => {
  assert.deepEqual(BENCHMARK_FIXTURES.map((item) => item.id), EXPECTED_IDS);
});

test("benchmark scoring is binary for fixed expectations", () => {
  const result = {
    choices: { local_status: { choice: "review", probabilities: { clear: 0, review: 1, rework: 0, unknown: 0 } } },
    nouls: { concrete_issue: 0.9, spec_mismatch: 0.1, regression_risk: 0.1 },
  };
  assert.equal(scoreBenchmarkFixture(BENCHMARK_FIXTURES[1], result), 100);
  assert.equal(scoreBenchmarkFixture(BENCHMARK_FIXTURES[0], result), 0);
});

test("remote benchmark applies the normal bounded provider timeout", async () => {
  let receivedTimeout;
  const observation = await runRemoteBenchmark(0, {
    apiKey: "fixture-key",
    callSystemOneImpl: async ({ timeoutMs }) => {
      receivedTimeout = timeoutMs;
      return {
        model: "jev-1.13.0",
        choices: { local_status: { choice: "clear", probabilities: { clear: 1, review: 0, rework: 0, unknown: 0 } } },
        nouls: { concrete_issue: 0, spec_mismatch: 0, regression_risk: 0 },
      };
    },
  });
  assert.equal(receivedTimeout, 45_000);
  assert.equal(observation.score, 100);
});

test("remote benchmark rejects model drift from the pinned Jev model", async () => {
  const observation = await runRemoteBenchmark(0, {
    apiKey: "fixture-key",
    callSystemOneImpl: async () => ({
      model: "jev-unexpected",
      choices: { local_status: { choice: "clear", probabilities: { clear: 1, review: 0, rework: 0, unknown: 0 } } },
      nouls: { concrete_issue: 0, spec_mismatch: 0, regression_risk: 0 },
    }),
  });
  assert.equal(observation.fixture_id, "clear-code");
  assert.equal(observation.score, null);
  assert.equal(observation.error, "provider_error");
});

test("rolling state is bounded and mean excludes null", () => {
  const normalized = normalizeBenchmarkState({
    schema_version: 1,
    next_fixture_index: 12,
    recent_scores: [100, null, 0, 100, 0, 100, null, 100, 0, 100, 100, 0],
  });
  assert.equal(normalized.next_fixture_index, 12 % EXPECTED_IDS.length);
  assert.equal(normalized.recent_scores.length, 10);
  assert.equal(rollingMean([100, null, 0, 100]), 200 / 3);
  assert.equal(rollingMean([null]), null);
});

test("history event allowlists metadata and excludes source/path markers", () => {
  const marker = "PRIVATE_SOURCE_MARKER";
  const event = buildHistoryEvent(report(marker), {
    surface: "rest",
    elapsedMs: 321,
    benchmark: {
      fixture_id: "clear-code",
      score: 100,
      error: null,
      recent_scores: [100],
      recent_mean: 100,
    },
    timestamp: "2026-09-27T00:00:00.000Z",
  });
  const text = JSON.stringify(event);
  assert.equal(event.event, "jev_audit_history");
  assert.equal(event.surface, "rest");
  assert.equal(event.elapsed_ms, 321);
  assert.equal(event.model, "jev-1.13.0");
  assert.doesNotMatch(text, new RegExp(marker));
  assert.doesNotMatch(text, /truncated_paths|highest_risk_batches|paths/);
});

test("remote observability runs one fixture, writes bounded state, and logs one event", async () => {
  const events = [];
  const writes = [];
  const env = {
    JEV_AUDIT_BENCHMARK_STATE: {
      async get() { return { schema_version: 1, next_fixture_index: 2, recent_scores: [100, null] }; },
      async put(key, value) { writes.push([key, JSON.parse(value)]); },
    },
  };
  let benchmarkCalls = 0;
  const event = await recordRemoteAudit({
    env,
    report: report(),
    surface: "remote_mcp",
    elapsedMs: 88,
    benchmarkRunner: async (index) => {
      benchmarkCalls += 1;
      assert.equal(index, 2);
      return { fixture_id: "spec-mismatch", score: 0, error: null };
    },
    logImpl: (value) => events.push(value),
    timestamp: "2026-09-27T00:00:00.000Z",
  });
  assert.equal(benchmarkCalls, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0][1].recent_scores, [100, null, 0]);
  assert.equal(writes[0][1].next_fixture_index, 3);
  assert.equal(events.length, 1);
  assert.equal(typeof events[0], "object");
  assert.deepEqual(events[0], event);
  assert.equal(event.surface, "remote_mcp");
});

test("state failures and benchmark failures remain bounded and non-throwing", async () => {
  const events = [];
  const env = {
    JEV_AUDIT_BENCHMARK_STATE: {
      async get() { throw new Error("KV SECRET BODY"); },
      async put() { throw new Error("KV WRITE SECRET"); },
    },
  };
  const event = await recordRemoteAudit({
    env,
    report: report(),
    surface: "rest",
    elapsedMs: 10,
    benchmarkRunner: async () => ({ fixture_id: "clear-code", score: null, error: "provider_error" }),
    logImpl: (value) => events.push(value),
  });
  assert.equal(event.benchmark.score, null);
  assert.equal(event.benchmark.error, "provider_error");
  assert.equal(events.length, 1);
  assert.equal(typeof events[0], "object");
  assert.doesNotMatch(JSON.stringify(events[0]), /KV SECRET BODY|KV WRITE SECRET/);
});

test("missing KV binding still emits a bounded event without failing", async () => {
  const events = [];
  const event = await recordRemoteAudit({
    env: {},
    report: report(),
    surface: "rest",
    elapsedMs: 10,
    benchmarkRunner: async () => ({ fixture_id: "clear-code", score: 100, error: null }),
    logImpl: (value) => events.push(value),
  });
  assert.equal(event.benchmark.score, 100);
  assert.equal(event.benchmark.error, "state_read_error");
  assert.equal(events.length, 1);
});

test("non-provider-backed remote audit logs history without benchmark call or state advance", async () => {
  const events = [];
  let benchmarkCalls = 0;
  let writes = 0;
  const env = {
    JEV_AUDIT_BENCHMARK_STATE: {
      async get() { return { schema_version: 1, next_fixture_index: 4, recent_scores: [100, 0] }; },
      async put() { writes += 1; },
    },
  };
  const audit = { ...report(), batches: 0 };
  const event = await recordRemoteAudit({
    env,
    report: audit,
    surface: "rest",
    elapsedMs: 5,
    benchmarkRunner: async () => { benchmarkCalls += 1; return { fixture_id: "x", score: 100, error: null }; },
    logImpl: (value) => events.push(value),
  });
  assert.equal(benchmarkCalls, 0);
  assert.equal(writes, 0);
  assert.equal(event.benchmark.fixture_id, null);
  assert.deepEqual(event.benchmark.recent_scores, [100, 0]);
  assert.equal(events.length, 1);
});

test("remote benchmark sample rate zero disables the extra provider call without changing audit history", async () => {
  let benchmarkCalls = 0;
  let writes = 0;
  const event = await recordRemoteAudit({
    env: {
      JEV_AUDIT_BENCHMARK_SAMPLE_RATE: "0",
      JEV_AUDIT_BENCHMARK_STATE: {
        async get() { return { schema_version: 1, next_fixture_index: 3, recent_scores: [100, 0] }; },
        async put() { writes += 1; },
      },
    },
    report: report(),
    surface: "rest",
    elapsedMs: 7,
    benchmarkRunner: async () => { benchmarkCalls += 1; return { fixture_id: "x", score: 100, error: null }; },
    logImpl: () => {},
  });
  assert.equal(benchmarkCalls, 0);
  assert.equal(writes, 0);
  assert.equal(event.benchmark.fixture_id, null);
  assert.deepEqual(event.benchmark.recent_scores, [100, 0]);
});

test("remote benchmark sampling is deterministic with injected random and fails safe on invalid config", async () => {
  let calls = 0;
  const env = { JEV_AUDIT_BENCHMARK_SAMPLE_RATE: "0.25" };
  await recordRemoteAudit({ env, report: report(), surface: "rest", elapsedMs: 1,
    benchmarkRunner: async () => { calls += 1; return { fixture_id: "clear-code", score: 100, error: null }; },
    random: () => 0.1, logImpl: () => {} });
  await recordRemoteAudit({ env, report: report(), surface: "rest", elapsedMs: 1,
    benchmarkRunner: async () => { calls += 1; return { fixture_id: "clear-code", score: 100, error: null }; },
    random: () => 0.9, logImpl: () => {} });
  assert.equal(calls, 1);

  const invalid = await recordRemoteAudit({
    env: { JEV_AUDIT_BENCHMARK_SAMPLE_RATE: "not-a-number" },
    report: report(), surface: "rest", elapsedMs: 1,
    benchmarkRunner: async () => { throw new Error("must not run"); },
    logImpl: () => {},
  });
  assert.equal(invalid.benchmark.fixture_id, null);
  assert.equal(invalid.benchmark.error, "benchmark_config_error");
});
