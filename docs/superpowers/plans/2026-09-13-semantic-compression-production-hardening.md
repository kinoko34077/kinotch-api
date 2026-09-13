# Semantic Compression Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Close the five production-qualification gaps in the dedicated semantic-compression release path without changing its fixed API, private Worker boundary, or existing routes.

**Architecture:** Keep Gemini generation inside the private `semantic-compression` Worker and keep `/v1/compress` behind the Gateway `COMPRESSION` Service Binding. Separate non-billable Cloudflare propagation/readiness polling from the one billable Gemini smoke request, make the first Worker deployment bootstrap-safe, and reject inputs above a conservative provider-context safety cap before the external call.

**Tech Stack:** Cloudflare Workers, Hono, Wrangler 4, Node.js test runner, ESM JavaScript, JSON5 deployment configs.

**Spec:** `docs/superpowers/specs/2026-09-13-semantic-compression-design.md` and the production review supplied in the user request.

## Global Constraints

- Preserve existing Gateway routes, Text Core, Text Worker behavior, and all existing Service Bindings.
- Keep `semantic-compression` independent, `workers_dev:false`, `preview_urls:false`, with no public Worker route.
- Accept only `{ text, profile }`; keep `semantic-dense-v1`, `gemini-3.5-flash-lite`, fixed prompt, `store:false`, and no caller-controlled provider options.
- Never log or return input text, compressed text, credentials, prompt text, or raw Gemini response data.
- Do not retry an ambiguous Gemini generation request; only retry non-provider propagation/readiness checks.
- Do not run live Gemini calls or production deploys without explicitly supplied operator credentials.
- Use TDD: each behavior change gets a failing regression test before production code, then focused and full verification.

---

### Task 1: Make production smoke one-shot and propagation-aware

**Files:**
- Modify: `scripts/smoke-production.mjs`
- Modify: `scripts/deploy-production.mjs`
- Test: `test/smoke-production.test.js`
- Test: `test/deploy-production.test.js`

**Interfaces:**
- `runCompressionSmoke({ fetchImpl, token, path, timeoutMs })` performs exactly one authenticated Gemini-backed smoke request and uses a 60-second client timeout by default.
- `runCompressionGatewayReadiness({ fetchImpl, path })` performs a token-free `GET /v1/compress` method/readiness check and never invokes Gemini.
- `checkDirectCompressionWorker({ fetchImpl })` returns safe direct Worker reachability evidence.

- [x] **Step 1: Write failing smoke tests**

Add tests for the exported 60-second Compression smoke timeout constant, the `GET /v1/compress` readiness response requiring `405` and `Allow: POST`, and direct Compression Worker reachability classification. Add source assertions that release deployment no longer calls `runCompressionSmokeWithRetry` and that the final Gateway smoke uses `checkCompression: false`.

- [x] **Step 2: Run focused tests to verify the new tests fail**

Run: `node --test test/smoke-production.test.js test/deploy-production.test.js`

Expected: FAIL because the configurable timeout, readiness helper, direct Compression check, and one-shot deployment wiring are absent.

- [x] **Step 3: Implement the smallest smoke boundary change**

Make the common request helper accept an optional timeout while preserving its 15-second default for existing checks. Use `COMPRESSION_SMOKE_TIMEOUT_MS = 60_000` for the single Compression generation smoke. Add readiness polling in the release script only around `GET /v1/compress`; call `runCompressionSmoke` once after readiness succeeds, then run the complete Gateway smoke with `checkCompression:false`. Add a direct Compression Worker health check beside the existing Text Worker check and reject a reachable direct endpoint.

- [x] **Step 4: Run focused tests to verify the fix**

Run: `node --test test/smoke-production.test.js test/deploy-production.test.js`

Expected: PASS with no retry wrapper around the Gemini smoke and no duplicate Compression generation in the release script.

- [x] **Step 5: Commit and push the smoke hardening**

```powershell
git add scripts/smoke-production.mjs scripts/deploy-production.mjs test/smoke-production.test.js test/deploy-production.test.js
git commit -m "fix: make compression smoke one-shot"
git push origin main
```

### Task 2: Make first Compression Worker deployment bootstrap-safe

**Files:**
- Modify: `scripts/deploy-production.mjs`
- Modify: `scripts/release-recovery.mjs`
- Test: `test/deploy-production.test.js`
- Test: `test/release-recovery.test.js`

**Interfaces:**
- `parseOptionalActiveVersionId(jsonText, workerName)` returns a single 100%-active version ID or `null` when the Worker has no deployment yet.
- `isMissingWorkerDeploymentError(message)` identifies only a not-found Worker/deployment response so authentication and network failures still stop the release.

- [x] **Step 1: Write failing bootstrap tests**

Test that an empty `versions` array returns `null`, a valid active version still returns its ID, malformed or ambiguous deployment status still throws, and a not-found Worker diagnostic is classified as bootstrap while an auth/network diagnostic is not. Add release source assertions that a missing previous Compression ID does not attempt Compression rollback.

- [x] **Step 2: Run focused tests to verify the new tests fail**

Run: `node --test test/release-recovery.test.js test/deploy-production.test.js`

Expected: FAIL because optional active-version parsing and missing-Worker classification are absent.

- [x] **Step 3: Implement bootstrap-safe version capture**

Capture Wrangler deployment-status diagnostics without exposing secrets. Treat a successful `versions: []` response and a narrowly classified not-found response as `previousCompressionVersionId:null`; preserve hard failure for other Wrangler errors. Keep rollback conditional on a non-null previous Compression version, allowing the new private Worker version to remain deployed if there is no prior version to restore.

- [x] **Step 4: Run focused tests to verify the fix**

Run: `node --test test/release-recovery.test.js test/deploy-production.test.js`

Expected: PASS, including strict behavior for malformed status and non-bootstrap failures.

- [x] **Step 5: Commit and push the bootstrap fix**

```powershell
git add scripts/deploy-production.mjs scripts/release-recovery.mjs test/deploy-production.test.js test/release-recovery.test.js
git commit -m "fix: support compression deployment bootstrap"
git push origin main
```

### Task 3: Enforce a provider-context safety boundary

**Files:**
- Modify: `src/semantic-compression/contract.js`
- Modify: `src/middleware/validation.js`
- Modify: `src/semantic-compression-worker.js`
- Modify: `docs/semantic-compression.md`
- Test: `test/semantic-compression-contract.test.js`
- Test: `test/compression-api.test.js`
- Test: `test/semantic-compression-worker.test.js`
- Test: `test/semantic-compression-docs.test.js`

**Interfaces:**
- Export `MAX_GEMINI_INPUT_CODE_POINTS = 200_000` as a conservative pre-provider safety cap.
- Return `413 provider_context_limit` for input over the provider safety cap but within the public one-million-code-point structural limit.
- Preserve `413 payload_too_large` for input over `MAX_COMPRESSION_TEXT_LENGTH`.

- [x] **Step 1: Write failing context-boundary tests**

Assert the new constant is `200_000`; Gateway and Worker reject a `200_001` code-point request with `provider_context_limit` before the binding/provider is called; a request over one million code points remains `payload_too_large`; and documentation explains that code points are not Gemini tokens.

- [x] **Step 2: Run focused tests to verify the new tests fail**

Run: `node --test test/semantic-compression-contract.test.js test/compression-api.test.js test/semantic-compression-worker.test.js test/semantic-compression-docs.test.js`

Expected: FAIL because only the one-million-code-point check exists.

- [x] **Step 3: Implement the shared conservative guard**

Add the constant to the semantic-compression contract and apply the same ordering in Gateway and Worker validation: strict body/profile checks, public maximum, then provider-context safety maximum. Do not add a `countTokens` provider call; document that the cap is conservative and prevents a known class of provider-side input errors without another billable/external request.

- [x] **Step 4: Run focused tests to verify the fix**

Run: `node --test test/semantic-compression-contract.test.js test/compression-api.test.js test/semantic-compression-worker.test.js test/semantic-compression-docs.test.js`

Expected: PASS and provider calls remain zero for rejected context-size inputs.

- [x] **Step 5: Commit and push the context hardening**

```powershell
git add src/semantic-compression/contract.js src/middleware/validation.js src/semantic-compression-worker.js docs/semantic-compression.md test/semantic-compression-contract.test.js test/compression-api.test.js test/semantic-compression-worker.test.js test/semantic-compression-docs.test.js
git commit -m "fix: guard compression provider context size"
git push origin main
```

### Task 4: Run qualification checks and record the boundary

**Files:**
- Modify: `docs/superpowers/plans/2026-09-13-semantic-compression-api.md`
- Modify: `docs/superpowers/plans/2026-09-13-semantic-compression-production-hardening.md`

- [x] **Step 1: Run the complete regression suite**

Run: `npm test`

Expected: all non-live tests pass and the opt-in live test remains skipped unless both the explicit flag and credential exist.

- [x] **Step 2: Run all three Wrangler dry-runs**

Run:

```powershell
npx wrangler deploy --config wrangler.text-transform.jsonc --dry-run
npx wrangler deploy --config wrangler.semantic-compression.jsonc --dry-run
npx wrangler deploy --config wrangler.jsonc --dry-run
```

Expected: all three pass; the Compression config remains private and no secret is printed.

- [x] **Step 3: Run privacy, scope, and formatting checks**

Run `git diff --check`, inspect the targeted `rg` credential/log search, and verify `git diff -- src/text-core` is empty. Confirm the release source has one Compression generation smoke call and a propagation-only retry helper.

- [x] **Step 4: Commit and push the verified hardening boundary**

Record actual command results, leave live/production evidence unchecked without operator credentials, then commit and push the plan/status update.

```powershell
git add docs/superpowers/plans/2026-09-13-semantic-compression-api.md docs/superpowers/plans/2026-09-13-semantic-compression-production-hardening.md
git commit -m "chore: record compression production hardening"
git push origin main
```

## Verification gaps that remain intentionally external

- `RUN_GEMINI_LIVE_TEST=true` plus an operator-provided `KINOTCH_COMPRESSION_GEMINI_API_KEY` is required for a real Gemini call.
- Production Worker secrets, caller smoke token, Cloudflare deploy, Gateway→Service Binding→Gemini smoke, and rollback behavior require operator credentials and production access; local tests and dry-runs do not prove them.

## Evidence recorded 2026-09-13 JST

- Focused RED tests failed on the missing readiness/export/context behavior; focused GREEN tests passed: smoke/release `27/27`, context/contract/docs `24/24`.
- Full `npm test` passed: `109` tests, `108` passed, `1` intentional live skip, `0` failed.
- Text, Compression, and Gateway Wrangler dry-runs each exited `0`.
- Read-only direct Compression Worker check returned `404` with `reachable:false` for `https://semantic-compression.kinotch.workers.dev/health`.
- `git diff --check` passed and `git diff --name-only -- src/text-core` returned no paths.
- Checkpoint commits `6c2fde5` and `09154dd` were pushed to `origin/main`; this plan/status commit is the remaining record update.
