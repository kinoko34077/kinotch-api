# jev-audit Remote API / MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose jev-audit v0.2.12 screening semantics through authenticated Cloudflare REST and Remote MCP surfaces while preserving the existing local Python CLI/STDIO MCP implementation.

**Architecture:** Add one private Cloudflare `jev-audit` Worker in `kinotch-api` that owns remote file-snapshot validation, batching, TypeSafe System One HTTP calls, response validation, and deterministic aggregation. Both `POST /v1/audit` on the existing gateway and a new `jev-audit-mcp` Worker call that private Worker through a Service Binding, following the proven semantic-compression deployment pattern.

**Tech Stack:** Node.js 22, Cloudflare Workers/Wrangler 4.131.1, Hono, `@modelcontextprotocol/server`, `agents/mcp/server`, Zod, jose, built-in `fetch`, Node test runner.

**Spec:** Canonical approved design: `kinoko34077/jev-audit@434c493` → `docs/superpowers/specs/2026-09-25-remote-api-mcp-design.md`.

## Global Constraints

- Local `kinoko34077/jev-audit` Python behavior remains unchanged by this implementation.
- Hosted audit semantics identify themselves as copied from `jev-audit` `0.2.12`.
- Default remote model is `jev-1.13.0`; v1 exposes no caller model override.
- Remote profiles are exactly `development` and `generic`; v1 exposes no custom profile path.
- Remote callers submit explicit file snapshots; no Git clone, filesystem path, or `changed_only` support.
- Request body limit is 1 MiB; at most 100 files; path at most 512 Unicode code points; supplied content+change at most 500,000 Unicode code points.
- Effective content is capped at 12,000 Unicode code points per file using head / truncation marker / tail behavior.
- Batch target is 32,000 estimated characters, at most 32 batches, at most 4 concurrent TypeSafe calls, 45-second timeout per TypeSafe request.
- Public REST authentication secret is `JEV_AUDIT_API_TOKEN`; TypeSafe secret `TYPESAFE_API_KEY` exists only on the private `jev-audit` Worker.
- Remote MCP uses Cloudflare Access with `TEAM_DOMAIN` and `POLICY_AUD`, 1 MiB body limit, and 5 actor calls per 60 seconds.
- Private `jev-audit` Worker uses `workers_dev: false`.
- Existing semantic-compression REST/MCP behavior must not change.

## Review Focus

1. **TypeSafe HTTP schema drift:** a 2xx body using `answers` but missing required Choice/Noul fields must fail closed as `provider_response_invalid` before aggregation.
2. **Partial-provider failure:** if one batch fails or times out, the whole audit request must fail with a stable external error and not return a misleading partial clear/review result.
3. **Cost boundary:** malformed/oversized REST or MCP input must be rejected before any `JEV_AUDIT` Service Binding or TypeSafe call occurs.
4. **Authentication isolation:** REST bearer token and MCP Access JWT/actor claim must never be forwarded to the private Worker or logged as raw values.
5. **Semantic drift:** tests must pin the exact v0.2.12 status thresholds, profile text, required question names, and `audit_semantics_version` provenance.

---

### Task 1: Pin the remote jev-audit contract and semantics

**Files:**
- Create: `src/jev-audit/contract.js`
- Create: `test/jev-audit-contract.test.js`

**Interfaces:**
- Produces: `AUDIT_SEMANTICS_VERSION`, `AUDIT_SERVICE_VERSION`, `DEFAULT_JEV_MODEL`, `REMOTE_AUDIT_LIMITS`, `AUDIT_PROFILES`, `LOCAL_NOULS`, `validateAuditInput(body)`, `normalizeAuditFiles(files)`, `buildQuestionPayload(profileName)`, `estimateQuestionOverhead(profileName)`.
- Consumes: no new feature code.

- [ ] **Step 1: Write failing contract tests**

Create `test/jev-audit-contract.test.js` with assertions that:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIT_PROFILES,
  AUDIT_SEMANTICS_VERSION,
  DEFAULT_JEV_MODEL,
  REMOTE_AUDIT_LIMITS,
  validateAuditInput,
  normalizeAuditFiles,
} from "../src/jev-audit/contract.js";

test("remote contract pins v0.2.12 semantics and model", () => {
  assert.equal(AUDIT_SEMANTICS_VERSION, "0.2.12");
  assert.equal(DEFAULT_JEV_MODEL, "jev-1.13.0");
  assert.deepEqual(Object.keys(AUDIT_PROFILES).sort(), ["development", "generic"]);
  assert.equal(REMOTE_AUDIT_LIMITS.maxFiles, 100);
  assert.equal(REMOTE_AUDIT_LIMITS.maxRequestBytes, 1024 * 1024);
  assert.equal(REMOTE_AUDIT_LIMITS.maxSuppliedCodePoints, 500_000);
  assert.equal(REMOTE_AUDIT_LIMITS.maxFileContentCodePoints, 12_000);
  assert.equal(REMOTE_AUDIT_LIMITS.batchChars, 32_000);
  assert.equal(REMOTE_AUDIT_LIMITS.maxBatches, 32);
  assert.equal(REMOTE_AUDIT_LIMITS.maxConcurrency, 4);
});

test("validateAuditInput accepts only explicit remote snapshots", () => {
  assert.equal(validateAuditInput({ files: [{ path: "src/app.py", content: "print(1)" }] }).ok, true);
  assert.equal(validateAuditInput({ path: "C:/repo", files: [] }).ok, false);
  assert.equal(validateAuditInput({ files: [], changed_only: true }).ok, false);
  assert.equal(validateAuditInput({ files: [{ path: "a", content: "x" }], profile: "custom.json" }).ok, false);
});

test("normalizeAuditFiles truncates by Unicode code points and reports the path", () => {
  const content = "😀".repeat(12_100);
  const normalized = normalizeAuditFiles([{ path: "emoji.txt", content }]);
  assert.deepEqual(normalized.truncatedPaths, ["emoji.txt"]);
  assert.ok([...normalized.files[0].content].length <= 12_000);
});
```

Also add boundary tests for 101 files, path length 513 code points, total supplied characters over 500,000, unsupported top-level fields, missing/empty content, non-string change, duplicate/empty paths, and exact `development`/`generic` profile definitions copied from the Python bundled profiles.

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
node --test test/jev-audit-contract.test.js
```

Expected: FAIL because `src/jev-audit/contract.js` does not exist.

- [ ] **Step 3: Implement the minimal contract module**

Create `src/jev-audit/contract.js` with:

```js
export const AUDIT_SEMANTICS_VERSION = "0.2.12";
export const AUDIT_SERVICE_VERSION = "remote-v1";
export const DEFAULT_JEV_MODEL = "jev-1.13.0";

export const REMOTE_AUDIT_LIMITS = Object.freeze({
  maxRequestBytes: 1024 * 1024,
  maxFiles: 100,
  maxPathCodePoints: 512,
  maxSuppliedCodePoints: 500_000,
  maxFileContentCodePoints: 12_000,
  batchChars: 32_000,
  maxBatches: 32,
  maxConcurrency: 4,
  providerTimeoutMs: 45_000,
});
```

Copy the bundled `development` and `generic` criteria/rules and the three Noul prompts exactly from `jev-audit` v0.2.12. Implement strict input-field allowlists and return `{ ok: false, code, message }` rather than throwing for caller validation failures.

Use `[...text]` length for Unicode code-point limits. Implement truncation as head + `\n...<truncated>...\n` + tail with final content no longer than 12,000 code points.

- [ ] **Step 4: Run contract test and full suite**

Run:

```bash
node --test test/jev-audit-contract.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/jev-audit/contract.js test/jev-audit-contract.test.js
git commit -m "feat: define remote jev-audit contract"
```

---

### Task 2: Implement batching, TypeSafe HTTP evaluation, validation, and deterministic aggregation

**Files:**
- Create: `src/jev-audit/evaluator.js`
- Create: `test/jev-audit-evaluator.test.js`

**Interfaces:**
- Consumes: `normalizeAuditFiles`, `buildQuestionPayload`, `estimateQuestionOverhead`, limits and profiles from Task 1.
- Produces: `evaluateAudit(env, body, options?) -> Promise<AuditReport>`, `AuditRemoteError`, exported pure helpers `makeAuditBatches(files)`, `validateSystemOneResponse(payload)`, `aggregateAuditBatches(batchAudits)` for focused tests.

- [ ] **Step 1: Write failing batching/aggregation/provider tests**

Create `test/jev-audit-evaluator.test.js` covering:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateAuditBatches,
  evaluateAudit,
  makeAuditBatches,
  validateSystemOneResponse,
} from "../src/jev-audit/evaluator.js";

test("aggregation pins v0.2.12 rework threshold", () => {
  const aggregate = aggregateAuditBatches([
    {
      index: 1,
      paths: ["bad.py"],
      result: {
        choices: { local_status: { probabilities: { clear: .05, review: .10, rework: .70, unknown: .15 } } },
        nouls: { concrete_issue: .85, spec_mismatch: .10, regression_risk: .20 },
        usage: { input_tokens: 10, output_tokens: 5 },
        elapsed_ms: 20,
      },
    },
  ]);
  assert.equal(aggregate.overall.status, "rework");
  assert.equal(aggregate.overall.status_trigger.kind, "concrete_and_rework");
  assert.deepEqual(aggregate.overall.status_trigger.paths, ["bad.py"]);
});
```

Add cases pinning:

- risk `>= 0.55` → review;
- actionable `review + rework >= 0.60` → review;
- unknown `>= 0.80` only after no rework/review trigger;
- otherwise clear;
- top 10 risk batch ranking;
- missing token usage stays incomplete rather than being interpreted as zero;
- batch limit >32 fails before provider calls;
- one provider rejection causes whole `evaluateAudit` to reject;
- provider 401/403/422/429/5xx/timeout maps to stable codes;
- malformed 2xx response maps to `provider_response_invalid`;
- injected `fetchImpl` receives `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <TYPESAFE_API_KEY>`, `Content-Type: application/json`, the pinned model, and exact Choice/Noul question names.

- [ ] **Step 2: Run evaluator tests and verify RED**

Run:

```bash
node --test test/jev-audit-evaluator.test.js
```

Expected: FAIL because `evaluator.js` is missing.

- [ ] **Step 3: Implement evaluator with explicit provider transport**

Implement `AuditRemoteError` with only stable `code` and `status` properties exposed to surfaces.

Implement `callSystemOne` so it:

```js
const response = await fetchImpl("https://api.typesafe.ai/v1/systemone", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify({ state, questions, model: DEFAULT_JEV_MODEL }),
  signal,
});
```

Do not log provider response bodies or API keys. Use no automatic provider retry in remote v1; one caller request causes at most one TypeSafe request per batch.

`validateSystemOneResponse` must accept the current HTTP `answers` shape and transform it to the local semantic shape. Require exactly:

- `answers.local_status.choice`, `.confidence`, `.probabilities`;
- `answers.concrete_issue.noul`;
- `answers.spec_mismatch.noul`;
- `answers.regression_risk.noul`;
- non-empty `model`;
- usage numbers when present.

Reject non-finite/out-of-range probabilities and local-status probabilities not summing to 1 within `1e-6`.

Run batches with at most four workers and preserve batch index ordering in the final report regardless of completion order.

- [ ] **Step 4: Run focused and full tests**

Run:

```bash
node --test test/jev-audit-evaluator.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/jev-audit/evaluator.js test/jev-audit-evaluator.test.js
git commit -m "feat: add remote jev-audit evaluator"
```

---

### Task 3: Add the private jev-audit Worker boundary

**Files:**
- Create: `src/jev-audit-worker.js`
- Create: `wrangler.jev-audit.jsonc`
- Create: `test/jev-audit-worker.test.js`
- Modify: `scripts/deploy-guards.mjs`
- Modify: `test/deploy-guards.test.js`

**Interfaces:**
- Consumes: `evaluateAudit(env, body)`.
- Produces: private internal `POST /v1/audit` Worker response; Wrangler service named `jev-audit`.

- [ ] **Step 1: Write failing private Worker tests**

Pin these behaviors:

- only `POST /v1/audit` is accepted;
- malformed JSON → 400 `invalid_json`;
- contract-invalid input → 400/413 without provider call;
- missing `TYPESAFE_API_KEY` → 503 `provider_authentication_unavailable`;
- `AuditRemoteError` is converted to `{ error: code }` with `Cache-Control: no-store`;
- unknown exceptions → 500 `internal_error` without message/stack leakage;
- successful evaluator result is returned as JSON;
- `X-Request-ID` from the Service Binding request is echoed when present.

Add deploy-guard coverage requiring the `jev-audit` config to use `workers_dev: false`.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/jev-audit-worker.test.js test/deploy-guards.test.js
```

Expected: FAIL for missing Worker/config behavior.

- [ ] **Step 3: Implement private Worker and config**

`wrangler.jev-audit.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "jev-audit",
  "account_id": "fb59b3c4a3fb2cda44dad80638390309",
  "main": "src/jev-audit-worker.js",
  "workers_dev": false,
  "preview_urls": false,
  "compatibility_date": "2026-09-07",
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1,
    "redact_query_string": true,
    "logs": { "enabled": true, "head_sampling_rate": 1, "persist": true, "invocation_logs": false }
  }
}
```

Do not put `TYPESAFE_API_KEY` in Wrangler vars; it is a secret configured separately.

- [ ] **Step 4: Run tests and Wrangler dry-run**

Run:

```bash
node --test test/jev-audit-worker.test.js test/deploy-guards.test.js
npx wrangler deploy --config wrangler.jev-audit.jsonc --dry-run
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/jev-audit-worker.js wrangler.jev-audit.jsonc scripts/deploy-guards.mjs test/jev-audit-worker.test.js test/deploy-guards.test.js
git commit -m "feat: add private jev-audit worker"
```

---

### Task 4: Add authenticated REST `POST /v1/audit` to the existing gateway

**Files:**
- Modify: `src/middleware/authentication.js`
- Modify: `src/middleware/validation.js`
- Modify: `src/policies/routes.js`
- Modify: `src/routes/api.js`
- Modify: `wrangler.jsonc`
- Create: `test/jev-audit-api.test.js`

**Interfaces:**
- Consumes: existing `registerRoute`, `proxyToWorker`, Service Binding `JEV_AUDIT`.
- Produces: public `POST /v1/audit` authenticated by `JEV_AUDIT_API_TOKEN`.

- [ ] **Step 1: Write failing gateway tests**

Use the existing compression API test style and pin:

- no bearer → 401 `authentication_failed` and zero upstream calls;
- wrong bearer → 401 and zero upstream calls;
- missing `JEV_AUDIT_API_TOKEN` → 503 `authentication_unavailable`;
- valid bearer + valid body proxies once to `JEV_AUDIT` with path `/v1/audit`;
- 1 MiB+1 request → 413 before upstream;
- invalid profile / 101 files / unsupported fields → validation error before upstream;
- service unavailable → existing `upstream_unavailable` behavior;
- private Worker 429/4xx is preserved where the existing proxy policy preserves it; 5xx is safely normalized by `proxyToWorker`;
- request-id is forwarded; raw bearer token is not forwarded.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/jev-audit-api.test.js
```

Expected: FAIL because route/policy/auth do not exist.

- [ ] **Step 3: Implement REST surface using existing middleware**

Add `authenticateJevAudit(c)` using the same constant-time SHA-256 comparison pattern as compression but reading `JEV_AUDIT_API_TOKEN` and writing `jevAuditAuthFingerprint`.

Add `validateJevAuditBody(body)` by delegating to `validateAuditInput` so gateway and private Worker share the same contract knowledge rather than duplicating field rules.

Add three dedicated rate-limit bindings:

- `JEV_AUDIT_PREAUTH_RATE_LIMITER`: 5 / 60s by caller IP;
- `JEV_AUDIT_RATE_LIMITER`: 5 / 60s normal route key;
- `JEV_AUDIT_TOKEN_RATE_LIMITER`: 5 / 60s keyed by token fingerprint.

Add `JEV_AUDIT` Service Binding to service `jev-audit`.

Register:

```js
registerRoute(apiRoutes, "POST", "/v1/audit", routePolicies.jevAudit, (c) =>
  proxyToWorker(c, c.env.JEV_AUDIT, "/v1/audit", {
    method: "POST",
    headers: { "Content-Type": c.req.header("content-type") ?? "application/json" },
    timeoutMs: routePolicies.jevAudit.upstreamTimeoutMs,
  }),
);
```

Set gateway upstream timeout greater than a single provider timeout and sufficient for up to four concurrent waves; use `120_000` ms initially because max 32 batches at concurrency 4 can exceed one 45-second provider window in failure cases.

- [ ] **Step 4: Run REST tests, gateway dry-run, full suite**

Run:

```bash
node --test test/jev-audit-api.test.js test/api.test.js test/compression-api.test.js
npx wrangler deploy --config wrangler.jsonc --dry-run
npm test
```

Expected: PASS with semantic-compression regression tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/middleware/authentication.js src/middleware/validation.js src/policies/routes.js src/routes/api.js wrangler.jsonc test/jev-audit-api.test.js
git commit -m "feat: expose jev-audit REST gateway"
```

---

### Task 5: Add Remote MCP with Cloudflare Access and the same private Worker

**Files:**
- Create: `src/jev-audit-mcp-worker.js`
- Create: `src/jev-audit-mcp/access-auth.js`
- Create: `src/jev-audit-mcp/body-limit.js`
- Create: `src/jev-audit-mcp/contract.js`
- Create: `src/jev-audit-mcp/rate-limit.js`
- Create: `src/jev-audit-mcp/server.js`
- Create: `src/jev-audit-mcp/upstream.js`
- Create: `wrangler.jev-audit-mcp.jsonc`
- Create: `test/jev-audit-mcp-auth.test.js`
- Create: `test/jev-audit-mcp-contract.test.js`
- Create: `test/jev-audit-mcp-upstream.test.js`
- Create: `test/jev-audit-mcp-worker.test.js`

**Interfaces:**
- Consumes: Service Binding `JEV_AUDIT`; proven compression MCP structure.
- Produces: `audit_files({ files, profile? })`, `list_profiles()` over Streamable HTTP at `/mcp`.

- [ ] **Step 1: Write failing MCP contract/upstream/worker tests**

Mirror existing semantic-compression MCP tests but assert jev-audit-specific behavior:

```js
assert.deepEqual(toolNames.sort(), ["audit_files", "list_profiles"]);
```

Pin:

- `list_profiles` returns exactly `["development", "generic"]`;
- `audit_files` Zod schema rejects local `path`, `changed_only`, model, and unsupported fields;
- upstream calls internal `https://jev-audit.internal/v1/audit` through Service Binding;
- upstream validates the required AuditReport fields and `audit_semantics_version === "0.2.12"`;
- upstream timeout → `audit_timeout`;
- 400 → `invalid_input`; 413 → `payload_too_large`; 429 → `rate_limited`; 5xx → `audit_unavailable`; malformed 200 → `invalid_upstream_response`;
- missing/invalid Access JWT → 401;
- invalid `TEAM_DOMAIN`/`POLICY_AUD` → 503 authentication unavailable;
- actor claim is hashed before rate-limit use;
- only `/mcp` is accepted;
- 1 MiB+1 body is rejected before handler;
- unknown handler error returns generic `internal_error`.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/jev-audit-mcp-*.test.js
```

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement MCP by adapting the proven compression modules**

Copy the security structure from `semantic-compression-mcp` without refactoring production compression code in this change.

`wrangler.jev-audit-mcp.jsonc` must contain:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "jev-audit-mcp",
  "account_id": "fb59b3c4a3fb2cda44dad80638390309",
  "main": "src/jev-audit-mcp-worker.js",
  "workers_dev": true,
  "preview_urls": false,
  "services": [{ "binding": "JEV_AUDIT", "service": "jev-audit" }],
  "ratelimits": [{
    "name": "MCP_RATE_LIMITER",
    "namespace_id": "<new unique namespace id>",
    "simple": { "limit": 5, "period": 60 }
  }],
  "compatibility_date": "2026-09-07"
}
```

The namespace id must be allocated separately from the compression MCP namespace before production deploy; tests/dry-run may use the final allocated id once known.

Return MCP `content` with a compact textual status/reason and `structuredContent` with the full audit report. Do not stringify and duplicate the whole report into both channels.

- [ ] **Step 4: Run MCP tests and dry-run**

Run:

```bash
node --test test/jev-audit-mcp-*.test.js
npx wrangler deploy --config wrangler.jev-audit-mcp.jsonc --dry-run --var TEAM_DOMAIN:https://example.cloudflareaccess.com --var POLICY_AUD:test-aud
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/jev-audit-mcp-worker.js src/jev-audit-mcp wrangler.jev-audit-mcp.jsonc test/jev-audit-mcp-*.test.js
git commit -m "feat: add jev-audit remote MCP"
```

---

### Task 6: Add deploy, smoke, and rollback integration without expanding scope

**Files:**
- Create: `scripts/jev-audit-release.mjs`
- Create: `scripts/smoke-jev-audit.mjs`
- Modify: `scripts/deploy-production.mjs`
- Modify: `scripts/release-child-env.mjs`
- Modify: `package.json`
- Create: `test/jev-audit-release.test.js`
- Create: `test/smoke-jev-audit.test.js`
- Modify: `test/deploy-production.test.js`
- Modify: `test/release-child-env.test.js`

**Interfaces:**
- Produces: deploy args/state for private Worker and MCP Worker; REST smoke helper; authenticated MCP handshake/tool-call smoke helper integration; release metadata and rollback version ids.

- [ ] **Step 1: Write failing release/smoke tests**

Pin:

- private Worker deploy config/name `jev-audit`;
- MCP worker deploy config/name `jev-audit-mcp`;
- endpoint exactly `https://jev-audit-mcp.kinotch.workers.dev/mcp`;
- production deploy requires `TEAM_DOMAIN`, jev-audit MCP `POLICY_AUD`, REST smoke bearer input, MCP smoke Access cookie, and confirms TypeSafe secret presence only through operator/Wrangler secret configuration—not by copying it into child environment logs;
- REST smoke sends a tiny fixture and validates top-level report/provenance fields;
- MCP recovery smoke can perform handshake without billable tool call;
- full smoke may perform one tool call only when explicitly configured;
- deploy state captures previous/current private and MCP Worker version ids and can roll back with existing recovery helpers.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/jev-audit-release.test.js test/smoke-jev-audit.test.js test/deploy-production.test.js test/release-child-env.test.js
```

Expected: FAIL because integration is absent.

- [ ] **Step 3: Implement minimal deployment integration**

Add package scripts:

```json
"dev:jev-audit": "wrangler dev --config wrangler.jev-audit.jsonc",
"dev:jev-audit-mcp": "wrangler dev --config wrangler.jev-audit-mcp.jsonc",
"smoke:jev-audit": "node scripts/smoke-jev-audit.mjs"
```

Extend `deploy-production.mjs` in the same sequence pattern used by compression:

1. tests and generated-file checks;
2. dry-run private jev-audit Worker;
3. dry-run jev-audit MCP Worker;
4. gateway dry-run;
5. capture previous versions;
6. deploy private Worker;
7. run non-public/readiness check where possible;
8. deploy MCP Worker;
9. deploy gateway binding/policy changes;
10. run REST live smoke;
11. run authenticated MCP handshake and one explicit tool-call smoke;
12. write release record;
13. if smoke fails after a deployment, roll back the changed Worker(s) with existing recovery utilities.

Keep semantic-compression deployment order and smoke behavior unchanged.

- [ ] **Step 4: Run release tests and dry-runs**

Run:

```bash
node --test test/jev-audit-release.test.js test/smoke-jev-audit.test.js test/deploy-production.test.js test/release-child-env.test.js
npx wrangler deploy --config wrangler.jev-audit.jsonc --dry-run
npx wrangler deploy --config wrangler.jev-audit-mcp.jsonc --dry-run --var TEAM_DOMAIN:https://example.cloudflareaccess.com --var POLICY_AUD:test-aud
npx wrangler deploy --config wrangler.jsonc --dry-run
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/jev-audit-release.mjs scripts/smoke-jev-audit.mjs scripts/deploy-production.mjs scripts/release-child-env.mjs package.json package-lock.json test/jev-audit-release.test.js test/smoke-jev-audit.test.js test/deploy-production.test.js test/release-child-env.test.js
git commit -m "feat: deploy and smoke jev-audit remote surfaces"
```

---

### Task 7: Document remote usage, secrets, ownership, and current state

**Files:**
- Create: `docs/jev-audit.md`
- Modify: `README.md`
- Modify: `docs/USAGE.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/DEVELOPMENT_HISTORY.md`
- Modify: `CHANGELOG.md`
- Modify: `project/docs/CURRENT_STATE.md`
- Create: `test/jev-audit-docs.test.js`

**Interfaces:**
- Produces: operator/user documentation that distinguishes local Python audit from hosted snapshot audit.

- [ ] **Step 1: Write failing docs test**

Assert docs contain and do not contradict:

- REST endpoint `/v1/audit`;
- MCP endpoint `https://jev-audit-mcp.kinotch.workers.dev/mcp`;
- remote tool names `audit_files` and `list_profiles`;
- remote v1 does not read local filesystem/Git and has no `changed_only`;
- remote semantics provenance is `0.2.12`;
- `JEV_AUDIT_API_TOKEN`, `TYPESAFE_API_KEY`, `TEAM_DOMAIN`, and jev-audit MCP audience are documented as secrets/vars in the correct Worker boundary;
- `TYPESAFE_API_KEY` must not be configured on gateway or MCP Worker;
- Cloudflare logs do not intentionally log source/diff contents;
- live TypeSafe E2E remains “pending” until actually performed.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/jev-audit-docs.test.js
```

- [ ] **Step 3: Update docs/current state**

Document local vs remote surfaces with a compact table. Record remote implementation as implemented-but-not-production-verified until live secrets and deployment smoke are completed. Do not mark live TypeSafe or authenticated MCP tool-call evidence complete before execution.

- [ ] **Step 4: Run docs/full verification**

Run:

```bash
node --test test/jev-audit-docs.test.js
npm test
./knt.cmd verify
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/jev-audit.md README.md docs/USAGE.md docs/OPERATIONS.md docs/DEVELOPMENT_HISTORY.md CHANGELOG.md project/docs/CURRENT_STATE.md test/jev-audit-docs.test.js
git commit -m "docs: document jev-audit remote service"
```

---

### Task 8: Final branch verification and production handoff

**Files:**
- No production code required unless verification reveals a defect.
- Update `project/docs/CURRENT_STATE.md` only with evidence actually obtained.

**Interfaces:**
- Validates all prior task outputs together.

- [ ] **Step 1: Run clean install and full automated verification**

Run from repository root:

```bash
npm ci
npm test
./knt.cmd setup
./knt.cmd doctor
./knt.cmd base-check
./knt.cmd verify
npx wrangler deploy --config wrangler.jev-audit.jsonc --dry-run
npx wrangler deploy --config wrangler.jev-audit-mcp.jsonc --dry-run --var TEAM_DOMAIN:https://example.cloudflareaccess.com --var POLICY_AUD:test-aud
npx wrangler deploy --config wrangler.jsonc --dry-run
```

Expected: all PASS.

- [ ] **Step 2: Verify secrets/configuration needed for production without exposing values**

Required operator state:

- private `jev-audit`: `TYPESAFE_API_KEY` secret;
- gateway `api`: `JEV_AUDIT_API_TOKEN` secret;
- `jev-audit-mcp`: `TEAM_DOMAIN`, jev-audit-specific `POLICY_AUD` vars;
- Cloudflare Access application/policy protecting `jev-audit-mcp.kinotch.workers.dev/mcp`;
- new unique Cloudflare rate-limit namespaces for REST audit and MCP audit bindings.

Do not print secret values in terminal or release records.

- [ ] **Step 3: Production deploy only after operator configuration exists**

Run the production deploy script. If the required Cloudflare/TypeSafe credentials are absent, stop at this boundary and record deployment as blocked rather than substituting dummy production values.

- [ ] **Step 4: Perform one live TypeSafe REST E2E and one authenticated MCP E2E**

REST fixture:

```json
{
  "files": [
    { "path": "SPEC.md", "content": "add(a,b) returns the sum of a and b." },
    { "path": "app.py", "content": "def add(a,b):\n    return a-b\n" }
  ],
  "profile": "development"
}
```

Success criteria are transport/contract completion, not a forced YELLOW/RED label:

- HTTP/MCP call succeeds;
- files_scanned > 0 and batches > 0;
- `provenance.resolved_model` is non-empty;
- `provenance.audit_semantics_version === "0.2.12"`;
- aggregate/status object is valid;
- no secret/source body appears in normal Worker logs.

- [ ] **Step 5: Update evidence only after live success, then commit**

Record exact deployed Worker version ids, smoke result, and live E2E date in the existing release/current-state format.

```bash
git add project/docs/CURRENT_STATE.md docs/releases
git commit -m "docs: record jev-audit remote verification"
```

- [ ] **Step 6: Push branch and open PR to protected `main`**

```bash
git push -u origin feat/jev-audit-remote-api-mcp
```

Open a PR targeting `main`; required `test` and `verify` checks must pass before merge.
