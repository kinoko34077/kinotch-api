# Jev Audit Remote lightweight history + rolling benchmark design

Status: **design proposed / user-approved concept / implementation not started**

Related:
- `kinotch-api#29`
- `devflow#63`
- `devflow#64`
- `devflow#65`–`#70`

Audit base: `3a46902db2ac51d7251cfd79dfb4660f191bc748`

## 1. Purpose

Add a deliberately small chronological observability layer for Jev Audit Remote and attach a rolling fixed-fixture benchmark signal to each completed REST/MCP audit.

The feature must preserve the current Jev Remote product boundary:

- Remote v1 receives explicit file snapshots only;
- REST and Remote MCP share the private `jev-audit` Worker evaluator;
- source/diff/auth/provider raw bodies are not retained in normal logs;
- Service Token remains the normal Production MCP authentication path;
- deployment/release remains explicitly confirmation-gated.

The feature is not a dashboard, analytics warehouse, experiment platform, billing system, or audit-content archive.

## 2. Required behavior

### R-RHIST-001 — one compact structured history event per completed audit

Each completed Jev Audit Remote invocation produces one structured chronological history event.

Surfaces:

- `rest`
- `remote_mcp`

The event is emitted through the existing Cloudflare observability/logging path. No D1/general history database is introduced.

### R-RHIST-002 — external response contracts stay unchanged

REST `/v1/audit` and MCP `audit_files` continue returning their existing Audit Report contracts.

History and benchmark data are side-channel observability. Do not add the rolling history to normal caller responses solely for this feature.

### R-RHIST-003 — private worker owns shared Remote observability semantics

The private `jev-audit` Worker remains the shared evaluator and should own benchmark execution/history projection so REST and MCP do not duplicate logic.

Public Gateway and MCP layers provide an internal trusted surface hint (`rest` or `remote_mcp`) when calling the private Service Binding. Because the private Worker has no public endpoint, this hint is not a caller authority/security input.

The private Worker emits the normalized structured history event after it has a completed Audit Report and benchmark observation.

### R-RHIST-004 — no audited content in history

History events must not contain:

- file content;
- `change`/diff content;
- file paths from the caller snapshot;
- Authorization bearer values;
- Cloudflare Access Service Token values;
- Access JWT assertions;
- `TYPESAFE_API_KEY`;
- raw TypeSafe request/response bodies;
- benchmark fixture bodies.

Only compact aggregate/provenance metadata is allowed.

## 3. History event contract

Schema version starts at `1`.

Representative structured event payload:

```json
{
  "event": "jev_audit_history",
  "schema_version": 1,
  "timestamp": "2026-09-26T04:00:00.000Z",
  "surface": "rest",
  "profile": "development",
  "status": "review",
  "risk": 0.63,
  "files_scanned": 12,
  "batches": 3,
  "elapsed_ms": 842,
  "model": "jev-1.13.0",
  "audit_semantics_version": "0.2.12",
  "audit_service_version": "remote-v1",
  "usage": {
    "input_tokens": 4210,
    "output_tokens": 320,
    "input_tokens_complete": true,
    "output_tokens_complete": true
  },
  "benchmark": {
    "fixture_id": "spec-mismatch",
    "score": 100,
    "error": null,
    "recent_scores": [100, 100, 0, 100],
    "recent_mean": 75.0
  }
}
```

### Field rules

- `timestamp`: UTC RFC3339/ISO-8601 generated when event finalizes.
- `surface`: trusted internal classification `rest` / `remote_mcp`.
- `profile`: existing fixed Remote profile name.
- `status`, `risk`, `files_scanned`, `batches`: existing Audit Report aggregate metadata.
- `elapsed_ms`: Remote request/evaluator elapsed metric chosen consistently in implementation and documented; do not mix provider-only latency with wall-clock without naming it.
- `model`: pinned resolved model returned/validated by the evaluator.
- `audit_semantics_version`, `audit_service_version`: existing Remote provenance.
- `usage`: provider-reported aggregate usage with existing completeness semantics; null remains null, not zero.
- `benchmark`: stable shape, including nulls where no valid benchmark score exists.

## 4. Benchmark contract

### R-RBENCH-001 — same fixed synthetic semantics as Local

Remote uses the same conceptual eight fixed synthetic cases as Local Jev Audit:

1. clear code;
2. concrete issue;
3. spec mismatch;
4. regression risk;
5. insufficient context / unknown;
6. strong rework;
7. benign config/docs;
8. mild review.

Fixtures are small, hand-authored, repository-independent and never copied from real caller source.

Exact fixture definitions may be implemented separately in JavaScript but their IDs and expected-outcome semantics must remain aligned with Local documentation/tests.

### R-RBENCH-002 — one fixture per provider-backed audit

After a real Remote audit completes through TypeSafe, run at most one additional small benchmark provider call.

Do not execute the full benchmark suite per request.

Remote v1 currently performs provider-backed audits for valid non-empty snapshot requests, so benchmark execution is normally expected on successful provider-backed requests. If a future no-provider/no-op path exists, it must not create a benchmark provider call merely for history.

### R-RBENCH-003 — pinned model / fixed benchmark contract

Remote benchmark uses:

- the pinned Production Jev model (`jev-1.13.0` under the current contract);
- a fixed benchmark question/profile contract independent of caller profile choice (`development` / `generic`).

Caller profile changes must not redefine expected benchmark outcomes.

### R-RBENCH-004 — scoring

- expected outcome satisfied: `100`;
- expected outcome mismatch: `0`;
- benchmark/provider/state execution failure preventing a valid score: `null`.

No weighted or calendar score is introduced.

### R-RBENCH-005 — rolling window

Each history event embeds the most recent **up to 10 benchmark observations**, including the current attempted observation.

- sequence values: `100`, `0`, or `null`;
- `recent_mean` uses numeric values only;
- `null` remains visible but is excluded from the mean denominator;
- zero numeric observations => `recent_mean = null`;
- no day/week/month aggregation.

## 5. Persistence ownership

### Chronological history

Owner: Cloudflare persistent structured observability logs already enabled for the Jev private/MCP Workers.

Do not add D1 or a separate general audit-history service.

The implementation emits one normalized event object with a stable event name so future manual querying is possible without introducing a product dashboard.

### Benchmark rolling state

Owner: one Jev-dedicated minimal KV binding/state record attached to the private `jev-audit` Worker.

Suggested logical state:

```json
{
  "schema_version": 1,
  "next_fixture_index": 4,
  "recent_scores": [100, null, 100, 0]
}
```

State contains no caller source/diff/path/auth information.

No per-user/per-repository/per-surface keys are required for the current low-volume single-operator design. One global Remote Jev benchmark sequence is sufficient.

## 6. Consistency / concurrency model

Benchmark state is observability-only and does not justify strong transactional infrastructure.

Workers KV/eventual consistency is acceptable for this feature.

Consequences explicitly accepted:

- concurrent requests may select the same fixture;
- concurrent writes may produce last-write-wins approximation in the rolling window;
- history event timestamps + fixture IDs preserve inspectability;
- no audit result depends on benchmark order/window precision.

Do not add Durable Objects or D1 only to serialize benchmark state.

Reconsider stronger serialization only if observed concurrent usage makes the benchmark history materially misleading.

## 7. Failure behavior

### Real audit/provider fails

Preserve the existing REST/MCP error contract. Do not turn a failed audit into a synthetic successful history score.

A bounded diagnostic log for the audit failure may continue under existing logging policy, but it is distinct from a completed-audit history event.

### Benchmark fails after real audit succeeds

The caller receives the successful real Audit Report unchanged.

History event records:

- selected `fixture_id`;
- `score = null`;
- bounded stable `error` classification such as `provider_error`, `state_read_error`, `state_write_error`, or `benchmark_invalid` as applicable;
- rolling sequence best-effort.

Raw provider error bodies are never logged.

### KV state read/write fails

Do not fail the real audit.

Behavior:

- state read failure: choose a safe fixture fallback and emit `score` if benchmark can still run; mark bounded state error;
- state write failure: emit the completed history event with the score and bounded state error, but do not change caller audit result;
- never leak binding configuration or credential material.

### Structured log emission fails

Do not change the audit response/status. Cloudflare logging failure is outside the audit correctness contract.

## 8. Internal request boundary

REST Gateway and Remote MCP need to provide surface classification to the private worker.

Preferred minimal contract:

- internal Service Binding request/header or internal request field set by trusted project code;
- values restricted to `rest` / `remote_mcp`;
- not accepted from public caller payload as authority;
- private worker defaults to `unknown` only for internal/test paths if needed, and production public entry points must set an expected value.

This metadata must not change audit validation/aggregation semantics.

## 9. Release/configuration boundary

Implementation may require:

- one KV namespace/binding in `wrangler.jev-audit.jsonc`;
- release dry-run/config contract updates;
- deployment/rollback version capture remains as existing;
- smoke/tests must validate binding presence and non-disclosure without depending on historical Production data.

Creating/attaching Production KV resources or deploying new Worker code has external effect and remains confirmation-gated.

Repository implementation/PR merge is not Production deployment authorization.

## 10. Compatibility requirements

Must remain true:

- REST request/response schema unchanged;
- MCP tool contract unchanged;
- Service Token remains normal Production MCP authentication;
- no Jev-specific Managed OAuth requirement;
- Remote v1 remains explicit-snapshot only;
- pinned-model fail-closed behavior remains;
- body/file/path/batch/rate limits remain unless independently changed;
- source/diff normal logging prohibition remains;
- existing release/rollback authority remains intact.

## 11. Suggested implementation boundaries

Exact module names are implementation detail. Responsibilities should be separated as:

- fixed benchmark fixture definitions + score predicates;
- benchmark runner reusing existing TypeSafe/provider validation path without weakening pinned-model validation;
- minimal benchmark state adapter (KV);
- history event projection/redaction;
- structured log emitter;
- internal surface metadata plumbing;
- post-audit observability orchestrator in private worker.

Do not duplicate evaluator thresholds/profile logic into Gateway/MCP.

## 12. Verification requirements

TDD/regression coverage must include at least:

1. history event contains only approved compact fields;
2. caller source/diff/path content is absent even when input contains marker secrets/unique strings;
3. Authorization/Access/provider credential values are never included;
4. REST marks surface `rest` through trusted internal plumbing;
5. MCP marks surface `remote_mcp`;
6. fixture rotation works in serial state;
7. recent window caps at 10;
8. `null` is excluded from numeric mean but remains visible;
9. matching fixture scores `100`, mismatch scores `0`;
10. benchmark provider failure does not fail normal audit;
11. KV read failure does not fail normal audit;
12. KV write failure does not fail normal audit;
13. pinned model validation also applies to benchmark call;
14. caller profile cannot redefine benchmark expectations;
15. response body remains existing Audit Report contract;
16. Wrangler/private-worker dry-run verifies required binding contract;
17. release tests do not record KV contents/secrets in metadata;
18. CI `test` and Verify remain green.

## 13. Non-goals

- D1/general audit database;
- Durable Object serialization;
- dashboard/charts;
- calendar aggregation;
- per-user or per-repository benchmark state;
- source/diff retention;
- cross-surface central history unification;
- remote repository cloning/filesystem support;
- full benchmark suite per request;
- graded/statistical benchmark platform;
- billing/account/tenant features.

## 14. Completion boundary

Repository implementation is complete only when:

- `kinotch-api#29` acceptance is satisfied;
- tests/CI/Verify pass on the implementation PR;
- Jev Remote user/operations docs and Current State are reconciled;
- changed-scope review finds no auth/privacy/result-contract/release regression.

Production rollout is a **separate phase** and requires explicit user confirmation before any deploy/resource creation that affects live Cloudflare state.