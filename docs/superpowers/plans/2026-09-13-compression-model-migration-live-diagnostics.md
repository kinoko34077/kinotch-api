# Compression Model Migration and Live Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the fixed Semantic Compression model to `gemini-3.5-flash-lite` and make opt-in local live-test failures show bounded provider diagnostics without changing the public API or production error contract.

**Architecture:** Keep `COMPRESSION_MODEL` in `src/semantic-compression/contract.js` as the single model source of truth. Parse only documented provider error fields inside the Gemini adapter into a bounded internal diagnostic object, pass it through a test-only Worker callback, and display it only when the explicitly enabled local live test fails; production responses continue to expose only the existing safe error contract.

**Tech Stack:** Cloudflare Worker JavaScript, Google Gemini Interactions API, Node.js built-in test runner, Markdown documentation, Wrangler dry-runs.

**Spec:** User-provided Gemini model migration and live diagnostics instructions (2026-09-13).

## Global Constraints

- Fixed model is exactly `gemini-3.5-flash-lite`; callers cannot select a model.
- `semantic-dense-v1`, `COMPRESSION_PROMPT_VERSION`, Prompt text, Interactions endpoint, `store:false`, request/response field names, and API contract remain unchanged.
- `KINOTCH_COMPRESSION_GEMINI_API_KEY` remains the local live-test credential; Worker Secret binding remains `GEMINI_API_KEY`; no fallback is allowed.
- Provider diagnostics may include only bounded `upstreamStatus`, provider status/code, optional provider reason, and a safe derived message; never raw response, headers, credentials, input, compressed text, or prompt text.
- Production `/v1/compress` errors remain normalized; diagnostics are not added to the public response or production logs.
- Keep `MAX_GEMINI_INPUT_CODE_POINTS = 200_000`, timeouts, rate limits, body limits, retry policy, rollback, deploy authority, Gateway, Text Core, and `dev_agent` unchanged.
- Do not run live Gemini without the already supplied operator credential being visible in the execution environment.

---

### Task 1: Lock the model migration and diagnostic contract with failing tests

**Files:**
- Modify: `test/semantic-compression-contract.test.js`
- Modify: `test/semantic-compression-worker.test.js`

**Interfaces:**
- `COMPRESSION_MODEL` must equal `gemini-3.5-flash-lite` in the existing contract and response assertions.
- `createCompressionWorkerApp({ fetchImpl, onProviderDiagnostic })` will provide a test-only observation hook receiving a safe diagnostic object on an HTTP provider failure.

- [x] **Step 1: Update model expectations and add the diagnostic regression test**

Change only existing expected model literals from `gemini-2.5-flash-lite` to `gemini-3.5-flash-lite`. Add a Worker test whose fake Gemini response is HTTP 404 with a documented error envelope containing status `NOT_FOUND`, ErrorInfo reason `MODEL_NOT_AVAILABLE`, and a raw message/metadata sentinel. Assert the Worker response remains `502` with only `provider_error`, while the callback receives exactly:

```js
{
  upstreamStatus: 404,
  providerStatus: "NOT_FOUND",
  providerReason: "MODEL_NOT_AVAILABLE",
  safeMessage: "Gemini request failed (NOT_FOUND)",
}
```

Also assert that the callback diagnostic and response body contain neither the raw message sentinel nor the fake API key. Add a second provider-error fixture using the documented Interactions shape `{ error: { code: "model_not_found", message: "..." } }` and assert that the adapter uses the safe provider code when no separate status is present and leaves `providerReason` null.

- [x] **Step 2: Run the focused tests to verify the expected failures**

Run:

```powershell
node --test test/semantic-compression-contract.test.js test/semantic-compression-worker.test.js
```

Expected: model assertions fail because the contract still exports `gemini-2.5-flash-lite`, and the new diagnostic assertion fails because the Worker hook/metadata do not exist.

### Task 2: Update the fixed model and implement bounded adapter diagnostics

**Files:**
- Modify: `src/semantic-compression/contract.js`
- Modify: `src/semantic-compression/gemini.js`
- Modify: `src/semantic-compression-worker.js`

**Interfaces:**
- `COMPRESSION_MODEL` exports exactly `"gemini-3.5-flash-lite"`.
- `CompressionProviderError` retains existing `code`, `status`, and `retryAfter` behavior and may additionally carry an internal `diagnostic` object.
- `requestGeminiCompression()` parses an HTTP error only for safe diagnostic fields, then throws the existing normalized `CompressionProviderError`.
- `createCompressionWorkerApp({ fetchImpl, onProviderDiagnostic })` invokes the callback defensively with the safe diagnostic object and never serializes that object into the public response.

- [x] **Step 1: Change only the single model constant**

Set:

```js
export const COMPRESSION_MODEL = "gemini-3.5-flash-lite";
```

Do not add another model definition or alter any other contract constant.

- [x] **Step 2: Add the minimal documented-error parser**

Implement a small internal parser in `src/semantic-compression/gemini.js` that reads only `payload.error.status`, `payload.error.code`, `payload.error.reason`, and a string `reason` from `payload.error.details[]`. Prefer `error.status`, use `error.code` only when status is absent, and use the first bounded ErrorInfo-style reason. Do not retain `error.message`, `details.metadata`, response headers, or the raw payload. Return `null` for missing diagnostic values and derive `safeMessage` only from the fixed phrase plus the bounded status/code.

For every non-2xx response, parse the JSON body best-effort before raising the existing `provider_rate_limited` or `provider_error` error. Preserve existing `Retry-After` normalization and status mapping. Parsing failure must still produce a safe diagnostic with `upstreamStatus` and null provider fields, not a new public error.

- [x] **Step 3: Add the test-only Worker observation boundary**

Accept `onProviderDiagnostic` only as an app-factory option used by local tests. When catching `CompressionProviderError`, invoke it inside a try/catch so observer failures cannot alter the response. Keep the existing `errorResponse()` body and production logging unchanged; no diagnostic fields may be sent to callers or logged by default.

- [x] **Step 4: Run the focused tests to verify the implementation**

Run:

```powershell
node --test test/semantic-compression-contract.test.js test/semantic-compression-worker.test.js
```

Expected: all contract and Worker tests pass, including fixed model request/response checks and safe diagnostic extraction.

### Task 3: Show diagnostics only in the opt-in local live test

**Files:**
- Modify: `test/semantic-compression-live.test.js`
- Modify: `test/semantic-compression-live-config.test.js` only if a no-provider diagnostic assertion is needed

**Interfaces:**
- The live test continues to resolve only `KINOTCH_COMPRESSION_GEMINI_API_KEY` and passes it to the Worker as `{ GEMINI_API_KEY: ... }`.
- On a non-200 live response, the test fails with the captured safe diagnostic object, never the response body, key, headers, input, compressed text, or prompt.

- [x] **Step 1: Add the safe diagnostic callback to the live path**

Construct the Worker app with `onProviderDiagnostic: (diagnostic) => { providerDiagnostic = diagnostic; }`. If the live response is not `200`, fail with `JSON.stringify(providerDiagnostic ?? { safeMessage: "Gemini request failed without diagnostic metadata" })`; otherwise keep the existing `validateCompressionPayload()` contract assertions. Keep the dedicated local environment resolver and no-old-key fallback unchanged.

- [x] **Step 2: Verify no-credential behavior without contacting Gemini**

Run the live test in a child process after removing `RUN_GEMINI_LIVE_TEST` and `KINOTCH_COMPRESSION_GEMINI_API_KEY` from that child environment. Expected: one intentional skip and no external request. Do not set or print a provider key.

### Task 4: Update current model documentation and historical plan/spec expectations

**Files:**
- Modify: `docs/API_PLAN.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/semantic-compression.md`
- Modify: `docs/superpowers/plans/2026-09-13-semantic-compression-api.md`
- Modify: `docs/superpowers/plans/2026-09-13-semantic-compression-production-hardening.md`
- Modify: `docs/superpowers/specs/2026-09-13-semantic-compression-design.md`
- Modify: `test/semantic-compression-docs.test.js`

**Interfaces:**
- Current operational and test-contract documentation names `gemini-3.5-flash-lite`.
- Documentation explicitly states that live diagnostics are safe derived metadata only and that production raw provider errors remain hidden.
- Existing local/Cloudflare credential names and all non-model operational limits remain unchanged.

- [x] **Step 1: Replace current model expectations only**

Update current response examples, fixed-provider descriptions, plan code snippets, release metadata expectations, smoke expectations, and docs test required strings from `gemini-2.5-flash-lite` to `gemini-3.5-flash-lite`. Do not alter `semantic-dense-v1`, Prompt text, `GEMINI_API_KEY`, `KINOTCH_COMPRESSION_GEMINI_API_KEY`, or any deployment setting.

- [x] **Step 2: Document diagnostic visibility boundaries**

In `docs/semantic-compression.md`, state that an explicitly enabled local live test may show `upstreamStatus`, provider status/code, optional provider reason, and a safe message on failure; production `/v1/compress` continues to return normalized errors without Google raw payloads. Keep the Worker Secret setup command exactly `wrangler secret put GEMINI_API_KEY --config wrangler.semantic-compression.jsonc`.

- [x] **Step 3: Run focused documentation and static model checks**

Run:

```powershell
node --test test/semantic-compression-docs.test.js
git grep -n "gemini-2.5-flash-lite"
git grep -n "gemini-3.5-flash-lite"
```

Expected: documentation tests pass; the old-model search has no matches except an explicitly retained migration-history note, and all current model references point to 3.5.

### Task 5: Full verification, dry-run, commit, and push

**Files:**
- Verify only: `wrangler.semantic-compression.jsonc`, `wrangler.jsonc`, `src/text-core`, `scripts/deploy-production.mjs`, `scripts/smoke-production.mjs`, `package.json`, and `dev_agent` outside this repository.

- [x] **Step 1: Run Semantic Compression focused tests**

Run:

```powershell
node --test test/semantic-compression-contract.test.js test/semantic-compression-worker.test.js test/semantic-compression-golden.test.js test/semantic-compression-live-config.test.js test/semantic-compression-live.test.js test/smoke-production.test.js
```

Expected: all non-live focused tests pass and the live test is skipped unless the dedicated operator credential is present. A real live test is not claimed without its output.

- [x] **Step 2: Run the normal regression suite**

Run `npm test` with live-test flag and dedicated local credential removed from the child environment. Expected: all tests pass, one intentional live skip, no external Gemini call.

- [x] **Step 3: Run the existing dry-runs and scope checks**

Run:

```powershell
npx wrangler deploy --config wrangler.semantic-compression.jsonc --dry-run
npx wrangler deploy --config wrangler.jsonc --dry-run
git diff --check
git diff --name-only HEAD -- src/text-core src/semantic-compression src/semantic-compression-worker.js scripts/deploy-production.mjs scripts/smoke-production.mjs wrangler.semantic-compression.jsonc wrangler.jsonc package.json
```

Expected: both dry-runs pass, `git diff --check` exits 0, and the protected-path query is empty before commit.

- [ ] **Step 4: Commit and push only the verified migration**

Use:

```powershell
git add src/semantic-compression/contract.js src/semantic-compression/gemini.js src/semantic-compression-worker.js test/semantic-compression-contract.test.js test/semantic-compression-worker.test.js test/semantic-compression-live.test.js docs/API_PLAN.md docs/OPERATIONS.md docs/semantic-compression.md docs/superpowers/plans/2026-09-13-semantic-compression-api.md docs/superpowers/plans/2026-09-13-semantic-compression-production-hardening.md docs/superpowers/specs/2026-09-13-semantic-compression-design.md test/semantic-compression-docs.test.js docs/superpowers/plans/2026-09-13-compression-model-migration-live-diagnostics.md
git commit -m "feat: migrate compression model to Gemini 3.5"
git push origin main
```

After push, fetch `origin/main`, confirm it equals `HEAD`, and report the commit SHA, test counts, dry-run results, protected-path result, and whether the opt-in live Gemini test was actually executed.
