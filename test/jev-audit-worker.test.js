import assert from "node:assert/strict";
import test from "node:test";

import { AuditRemoteError } from "../src/jev-audit/evaluator.js";
import { createJevAuditWorkerApp } from "../src/jev-audit-worker.js";

function request(body, headers = {}) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "audit-worker-test",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

const validBody = { files: [{ path: "src/app.py", content: "print(1)" }] };
const successReport = {
  profile: "development",
  files_scanned: 1,
  batches: 1,
  aggregate: { overall: { status: "clear", risk: 0, status_trigger: null } },
  truncated_paths: [],
  coverage: { submitted_files: 1, audited_files: 1, truncated_files: 0 },
  provenance: {
    service_version: "remote-v1",
    audit_semantics_version: "0.2.12",
    resolved_model: "jev-1.13.0",
    profile_name: "development",
    batch_count: 1,
    estimated_total_input_chars: 10,
  },
};

test("private audit Worker accepts only POST /v1/audit", async () => {
  const app = createJevAuditWorkerApp({ evaluateAuditImpl: async () => successReport });
  const env = { TYPESAFE_API_KEY: "fixture-key" };

  assert.equal((await app.request("https://internal.test/v1/audit", { method: "GET" }, env)).status, 405);
  assert.equal((await app.request("https://internal.test/other", request(validBody), env)).status, 404);
});

test("private audit Worker rejects malformed and invalid input before evaluation", async () => {
  let calls = 0;
  const app = createJevAuditWorkerApp({
    evaluateAuditImpl: async () => { calls += 1; return successReport; },
  });
  const env = { TYPESAFE_API_KEY: "fixture-key" };

  const malformed = await app.request("https://internal.test/v1/audit", request("{"), env);
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, "invalid_json");

  const invalid = await app.request(
    "https://internal.test/v1/audit",
    request({ files: [], changed_only: true }),
    env,
  );
  assert.equal(invalid.status, 400);
  assert.equal(calls, 0);
});

test("private audit Worker fails closed when TypeSafe secret is absent", async () => {
  let calls = 0;
  const app = createJevAuditWorkerApp({
    evaluateAuditImpl: async () => { calls += 1; return successReport; },
  });
  const response = await app.request("https://internal.test/v1/audit", request(validBody), {});
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.equal(payload.error, "provider_authentication_unavailable");
  assert.equal(calls, 0);
});

test("private audit Worker maps stable audit errors without leaking internal messages", async () => {
  const app = createJevAuditWorkerApp({
    evaluateAuditImpl: async () => {
      throw new AuditRemoteError("provider_rate_limit", 503, "upstream secret body");
    },
  });
  const response = await app.request(
    "https://internal.test/v1/audit",
    request(validBody),
    { TYPESAFE_API_KEY: "fixture-key" },
  );
  const text = await response.text();

  assert.equal(response.status, 503);
  assert.match(text, /provider_rate_limit/);
  assert.doesNotMatch(text, /upstream secret body/);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("private audit Worker redacts unexpected exceptions", async () => {
  const app = createJevAuditWorkerApp({
    evaluateAuditImpl: async () => { throw new Error("sensitive stack detail"); },
  });
  const response = await app.request(
    "https://internal.test/v1/audit",
    request(validBody),
    { TYPESAFE_API_KEY: "fixture-key" },
  );
  const text = await response.text();

  assert.equal(response.status, 500);
  assert.match(text, /internal_error/);
  assert.doesNotMatch(text, /sensitive stack detail/);
});

test("private audit Worker returns audit JSON and echoes safe request ID", async () => {
  let received;
  const app = createJevAuditWorkerApp({
    evaluateAuditImpl: async (env, body) => { received = { env, body }; return successReport; },
  });
  const response = await app.request(
    "https://internal.test/v1/audit",
    request(validBody),
    { TYPESAFE_API_KEY: "fixture-key" },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-request-id"), "audit-worker-test");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(payload.provenance.audit_semantics_version, "0.2.12");
  assert.deepEqual(received.body, validBody);
  assert.equal(received.env.TYPESAFE_API_KEY, "fixture-key");
});
