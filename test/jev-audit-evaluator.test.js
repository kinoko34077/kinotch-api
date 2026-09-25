import assert from "node:assert/strict";
import test from "node:test";

import {
  AuditRemoteError,
  aggregateAuditBatches,
  evaluateAudit,
  makeAuditBatches,
  validateSystemOneResponse,
} from "../src/jev-audit/evaluator.js";

function providerPayload({
  local = { clear: 0.7, review: 0.15, rework: 0.05, unknown: 0.1 },
  concrete = 0.1,
  mismatch = 0.1,
  regression = 0.1,
  model = "jev-1.13.0",
  usage = { input_tokens: 11, output_tokens: 0 },
} = {}) {
  const choice = Object.entries(local).sort((a, b) => b[1] - a[1])[0][0];
  return {
    model,
    answers: {
      local_status: { type: "choice", choice, confidence: local[choice], probabilities: local },
      concrete_issue: { type: "noul", noul: concrete },
      spec_mismatch: { type: "noul", noul: mismatch },
      regression_risk: { type: "noul", noul: regression },
    },
    ...(usage === undefined ? {} : { usage }),
  };
}

function batch(index, paths, payload, elapsedMs = 20) {
  const result = validateSystemOneResponse(payload);
  return { index, paths, result: { ...result, elapsed_ms: elapsedMs } };
}

test("makeAuditBatches preserves order and rejects an oversized single file", () => {
  const files = [
    { path: "a.js", content: "a".repeat(20_000), change: "", truncated: false },
    { path: "b.js", content: "b".repeat(20_000), change: "", truncated: false },
  ];
  const batches = makeAuditBatches(files);
  assert.equal(batches.length, 2);
  assert.deepEqual(batches.flatMap((item) => item.files.map((file) => file.path)), ["a.js", "b.js"]);

  assert.throws(
    () => makeAuditBatches([{ path: "huge.js", content: "x".repeat(32_000), change: "", truncated: false }]),
    (error) => error instanceof AuditRemoteError && error.code === "audit_batch_too_large",
  );
});

test("validateSystemOneResponse accepts current TypeSafe answer shape and preserves missing usage", () => {
  const parsed = validateSystemOneResponse(providerPayload({ usage: undefined }));
  assert.equal(parsed.model, "jev-1.13.0");
  assert.equal(parsed.choices.local_status.choice, "clear");
  assert.equal(parsed.nouls.concrete_issue, 0.1);
  assert.deepEqual(parsed.usage, { input_tokens: null, output_tokens: null });
});

test("validateSystemOneResponse fails closed on malformed probabilities and answer sets", () => {
  const malformed = providerPayload();
  malformed.answers.local_status.probabilities.clear = 0.2;
  assert.throws(
    () => validateSystemOneResponse(malformed),
    (error) => error instanceof AuditRemoteError && error.code === "provider_response_invalid",
  );

  const missing = providerPayload();
  delete missing.answers.spec_mismatch;
  assert.throws(
    () => validateSystemOneResponse(missing),
    (error) => error instanceof AuditRemoteError && error.code === "provider_response_invalid",
  );
});

test("aggregation pins v0.2.12 status thresholds and trigger paths", () => {
  const rework = aggregateAuditBatches([
    batch(1, ["bad.py"], providerPayload({
      local: { clear: 0.05, review: 0.1, rework: 0.7, unknown: 0.15 },
      concrete: 0.85,
    })),
  ]);
  assert.equal(rework.overall.status, "rework");
  assert.equal(rework.overall.status_trigger.kind, "concrete_and_rework");
  assert.deepEqual(rework.overall.status_trigger.paths, ["bad.py"]);

  const risk = aggregateAuditBatches([
    batch(1, ["risk.py"], providerPayload({ concrete: 0.55 })),
  ]);
  assert.equal(risk.overall.status, "review");
  assert.equal(risk.overall.status_trigger.kind, "concrete_risk");

  const actionable = aggregateAuditBatches([
    batch(1, ["review.py"], providerPayload({
      local: { clear: 0.2, review: 0.4, rework: 0.2, unknown: 0.2 },
    })),
  ]);
  assert.equal(actionable.overall.status, "review");
  assert.equal(actionable.overall.status_trigger.kind, "actionable_probability");

  const unknown = aggregateAuditBatches([
    batch(1, ["unknown.py"], providerPayload({
      local: { clear: 0.1, review: 0.05, rework: 0.05, unknown: 0.8 },
    })),
  ]);
  assert.equal(unknown.overall.status, "unknown");
  assert.equal(unknown.overall.status_trigger.kind, "unknown_probability");

  const clear = aggregateAuditBatches([batch(1, ["ok.py"], providerPayload())]);
  assert.equal(clear.overall.status, "clear");
  assert.equal(clear.overall.status_trigger, null);
});

test("aggregateAuditBatches reports incomplete usage without treating missing tokens as zero", () => {
  const aggregate = aggregateAuditBatches([
    batch(1, ["a.py"], providerPayload({ usage: { input_tokens: 10, output_tokens: 2 } })),
    batch(2, ["b.py"], providerPayload({ usage: undefined })),
  ]);
  assert.equal(aggregate.usage.input_tokens, 10);
  assert.equal(aggregate.usage.input_tokens_complete, false);
  assert.equal(aggregate.usage.input_tokens_missing_batches, 1);
});

test("evaluateAudit sends pinned System One request and returns deterministic report", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(providerPayload()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const report = await evaluateAudit(
    { TYPESAFE_API_KEY: "test-secret" },
    { files: [{ path: "src/app.py", content: "print(1)" }], profile: "development" },
    { fetchImpl },
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.headers.Authorization, "Bearer test-secret");
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.model, "jev-1.13.0");
  assert.deepEqual(Object.keys(body.questions).sort(), ["concrete_issue", "local_status", "regression_risk", "spec_mismatch"]);
  assert.equal(body.questions.local_status.type, "choice");
  assert.equal(body.questions.concrete_issue.type, "noul");
  assert.equal(body.state.files[0].path, "src/app.py");
  assert.equal(report.profile, "development");
  assert.equal(report.files_scanned, 1);
  assert.equal(report.batches, 1);
  assert.equal(report.aggregate.overall.status, "clear");
  assert.equal(report.provenance.audit_semantics_version, "0.2.12");
  assert.equal(report.provenance.resolved_model, "jev-1.13.0");
});

test("evaluateAudit maps provider status failures, timeout, and partial batch failure without retries", async () => {
  for (const [status, code] of [[401, "provider_authentication"], [403, "provider_permission_denied"], [422, "provider_unprocessable"], [429, "provider_rate_limit"], [500, "provider_internal"]]) {
    let calls = 0;
    await assert.rejects(
      evaluateAudit(
        { TYPESAFE_API_KEY: "test-secret" },
        { files: [{ path: "a.py", content: "x" }] },
        { fetchImpl: async () => { calls += 1; return new Response("hidden", { status }); } },
      ),
      (error) => error instanceof AuditRemoteError && error.code === code,
    );
    assert.equal(calls, 1);
  }

  await assert.rejects(
    evaluateAudit(
      { TYPESAFE_API_KEY: "test-secret" },
      { files: [{ path: "a.py", content: "x" }] },
      { fetchImpl: async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); } },
    ),
    (error) => error instanceof AuditRemoteError && error.code === "provider_timeout",
  );

  let calls = 0;
  await assert.rejects(
    evaluateAudit(
      { TYPESAFE_API_KEY: "test-secret" },
      { files: [
        { path: "a.py", content: "a".repeat(20_000) },
        { path: "b.py", content: "b".repeat(20_000) },
        { path: "c.py", content: "c".repeat(20_000) },
      ] },
      {
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) return new Response(JSON.stringify(providerPayload()), { status: 200 });
          return new Response("hidden", { status: 500 });
        },
      },
    ),
    (error) => error instanceof AuditRemoteError && error.code === "provider_internal",
  );
  assert.equal(calls, 2);
});
