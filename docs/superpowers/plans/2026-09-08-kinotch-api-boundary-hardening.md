# kinotch-api Boundary Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CORS、sourceRevision、private deploy assert、Text Worker rollback、client overall deadlineを実装し、基盤の責務境界を固定する。

**Architecture:** Gatewayは必要なresponse headersを公開し、Text Workerはrelease時だけcommit SHAをruntime variableとして受け取る。Release gateはprivate設定を先に検査し、Text smoke失敗時は直前active Versionをrollbackしてから停止する。Clientは全attemptを含むoverall deadlineでRetry-Afterを制限する。

**Tech Stack:** Hono 4、Cloudflare Workers、Wrangler 4.129.0、Node test runner、JSON5、ESM／browser IIFE generated client。

**Spec:** `docs/superpowers/specs/2026-09-08-kinotch-api-boundary-hardening-design.md`

## Global Constraints

- `workers_dev === false` and `preview_urls === false` are mandatory for `text-transform`.
- `sourceRevision` must equal the release gate's 40-character Git SHA and `docs/releases/*.json` `gitRevision`.
- Text Worker deploy precedes Gateway deploy; Text smoke failure must prevent Gateway deploy.
- Existing rule／snapshot checks, Golden outputs, local fallback, and API response shapes remain compatible; added metadata is additive.
- `totalDeadlineMs` includes attempts and retry waits; a Retry-After delay beyond the remaining deadline is not slept.
- No body or response body is written to structured logs.

---

### Task 1: Expose Gateway response headers to browser clients

**Files:**
- Modify: `src/middleware/cors.js`
- Test: `test/api.test.js`
- Modify: `docs/OPERATIONS.md`

**Interfaces:**
- Produces `Access-Control-Expose-Headers` containing `X-Request-ID`, `Retry-After`, `RateLimit-Limit`, `RateLimit-Policy`, and `ETag`.
- Produces preflight `Access-Control-Allow-Headers` containing `Content-Type` and `X-Request-ID`.

- [ ] **Step 1: Write the failing tests**

Add one preflight assertion for `Access-Control-Allow-Headers` and one Origin-bearing 429 request that asserts the expose list contains `Retry-After` and `RateLimit-Limit`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/api.test.js`

Expected: the current preflight has no explicit allowed request-header contract and the response expose-header assertion fails because `cors.js` has no `exposeHeaders` option.

- [ ] **Step 3: Implement the minimum CORS contract**

Update `corsMiddleware` with `allowHeaders: ["Content-Type", "X-Request-ID"]` and the five-header `exposeHeaders` list. Preserve wildcard origin and GET／POST／OPTIONS methods.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `npm test -- test/api.test.js`

Expected: all Gateway tests pass, including preflight and Origin-bearing 429 header assertions.

- [ ] **Step 5: Document the browser-readable headers**

Update `docs/OPERATIONS.md` to state that clients may read request ID, Retry-After, rate-limit, and ETag headers cross-origin.

- [ ] **Step 6: Commit**

```sh
git add src/middleware/cors.js test/api.test.js docs/OPERATIONS.md
git commit -m "Expose Gateway contract headers to browsers"
```

### Task 2: Inject sourceRevision and assert private Worker configuration

**Files:**
- Create: `scripts/deploy-guards.mjs`
- Modify: `scripts/deploy-production.mjs`
- Modify: `scripts/smoke-production.mjs`
- Test: `test/deploy-guards.test.js`
- Modify: `docs/API_PLAN.md`
- Modify: `docs/OPERATIONS.md`

**Interfaces:**
- `assertPrivateTextWorkerConfig(config)` throws when `workers_dev` or `preview_urls` is not false, or when `routes`, `route`, or `domains` is configured.
- `runProductionSmoke({ expectedSourceRevision })` checks the capabilities SHA when supplied and returns it in the summary.

- [ ] **Step 1: Write failing private-config tests**

Test a valid config and each invalid case: `workers_dev: true`, `preview_urls: true`, and a non-empty `routes` array. Assert the thrown message identifies the violated setting.

- [ ] **Step 2: Run the guard tests to verify they fail**

Run: `npm test -- test/deploy-guards.test.js`

Expected: module import fails because `scripts/deploy-guards.mjs` does not yet exist.

- [ ] **Step 3: Implement the pure config guard**

Create `assertPrivateTextWorkerConfig(config)` with explicit boolean checks and public-route checks. Do not inspect unrelated Worker settings.

- [ ] **Step 4: Run the guard tests to verify they pass**

Run: `npm test -- test/deploy-guards.test.js`

Expected: valid config passes and every unsafe config throws.

- [ ] **Step 5: Write the failing sourceRevision smoke test**

Extend the smoke contract with `expectedSourceRevision: "a".repeat(40)` and a capabilities payload whose `sourceRevision` is different. Assert the smoke rejects the response.

- [ ] **Step 6: Run the sourceRevision test to verify it fails**

Run: `npm test -- test/smoke-production.test.js`

Expected: this repository currently has no smoke test module or sourceRevision comparison, so add the focused test file with an injectable request function before implementation; the first assertion must fail on the missing comparison rather than on network access.

- [ ] **Step 7: Implement deploy-time SHA injection**

At the start of `deploy-production.mjs`, obtain `sourceRevision` using the existing safe-directory Git command and require `/^[a-f0-9]{40}$/`. Parse `wrangler.text-transform.jsonc` with JSON5 and run `assertPrivateTextWorkerConfig` before both dry-runs. Pass `--var TEXT_CORE_SOURCE_REVISION:<sourceRevision>` to Text Worker dry-run and deploy. Pass `expectedSourceRevision` to both Text and Gateway smoke calls.

- [ ] **Step 8: Implement smoke comparison and record field**

Make `runProductionSmoke` reject a supplied expected SHA mismatch and return `sourceRevision` in `capabilities`. Keep `unknown` valid when no expected value is supplied for local smoke.

- [ ] **Step 9: Run the focused sourceRevision and full tests**

Run: `npm test -- test/smoke-production.test.js test/text-transform-worker.test.js` and then `npm test`.

Expected: sourceRevision matching and mismatch cases pass; all existing Golden and Gateway tests remain green.

- [ ] **Step 10: Update operations and progress docs**

Document that production API `sourceRevision` equals the release record commit and mark the private deploy assertion as complete in `docs/API_PLAN.md`.

- [ ] **Step 11: Commit**

```sh
git add scripts/deploy-guards.mjs scripts/deploy-production.mjs scripts/smoke-production.mjs test/deploy-guards.test.js test/smoke-production.test.js docs/API_PLAN.md docs/OPERATIONS.md
git commit -m "Assert private Worker config and source revision"
```

### Task 3: Add Text Worker failure recovery and rollback metadata

**Files:**
- Create: `scripts/release-recovery.mjs`
- Modify: `scripts/deploy-production.mjs`
- Test: `test/release-recovery.test.js`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/API_PLAN.md`

**Interfaces:**
- `parseActiveVersionId(jsonText)` returns the 100%-active version ID from `wrangler deployments status --json` and rejects missing or invalid IDs.
- `createRollbackArgs(versionId, message)` returns the exact Wrangler rollback argument list.
- `rollbackAfterSmokeFailure({ previousVersionId, rollback })` runs the injected rollback operation and returns `{ status: "rolled_back", targetVersionId }`.

- [ ] **Step 1: Write failing rollback dry-scenario tests**

Cover JSON with one active 100% version, split versions without a 100% version, invalid IDs, exact rollback arguments, rollback success, and rollback rejection.

- [ ] **Step 2: Run the rollback tests to verify they fail**

Run: `npm test -- test/release-recovery.test.js`

Expected: module import fails because `scripts/release-recovery.mjs` does not yet exist.

- [ ] **Step 3: Implement pure recovery helpers**

Validate UUID-like Version IDs, select only the version with `percentage === 100`, construct `wrangler rollback <id> --name text-transform --message <message> --config wrangler.text-transform.jsonc`, and return structured recovery status.

- [ ] **Step 4: Run rollback tests to verify they pass**

Run: `npm test -- test/release-recovery.test.js`

Expected: all parser, command, success, and failure cases pass without any Cloudflare mutation.

- [ ] **Step 5: Add active-version lookup to the release gate**

Before Text deploy, run `wrangler deployments status --name text-transform --json --config wrangler.text-transform.jsonc` and parse its active Version ID. Refuse to deploy if no valid previous Version is available.

- [ ] **Step 6: Add failure record and rollback path**

When Text smoke throws, run rollback against the saved Version ID, record smoke error plus rollback result in a failed `docs/releases/*.json`, and rethrow so Gateway deploy is skipped. When rollback itself fails, record both errors and stop.

- [ ] **Step 7: Verify the release gate control flow locally**

Run: `node --check scripts/deploy-production.mjs` and `npm test -- test/release-recovery.test.js`.

Expected: syntax and dry recovery tests pass; no real rollback command is invoked by the test suite.

- [ ] **Step 8: Document recovery**

Add the active-version lookup, automatic rollback, failure metadata, and manual Cloudflare dashboard fallback to `docs/OPERATIONS.md`; update the release completion checklist in `docs/API_PLAN.md`.

- [ ] **Step 9: Commit**

```sh
git add scripts/release-recovery.mjs scripts/deploy-production.mjs test/release-recovery.test.js docs/OPERATIONS.md docs/API_PLAN.md
git commit -m "Rollback Text Worker after failed smoke"
```

### Task 4: Add client overall deadline

**Files:**
- Modify: `src/client/text-transform.js`
- Modify: `scripts/generate-browser-client.mjs`
- Modify: `src/client/text-transform.iife.js`
- Test: `test/text-transform-client.test.js`
- Modify: `docs/CLIENT_MIGRATION.md`
- Modify: `docs/API_PLAN.md`

**Interfaces:**
- `createTextTransformClient({ totalDeadlineMs })` defaults to `timeoutMs` when `timeoutMs > 0`; `0` disables the overall deadline while preserving existing no-timeout behavior.
- Deadline exhaustion produces `TextTransformApiError` with `code: "deadline_exceeded"`; server errors remain eligible for fallback.

- [ ] **Step 1: Write the failing deadline tests**

Add a 429 response with `Retry-After: 60`, `totalDeadlineMs: 100`, and an injected sleep function. Assert sleep is not called, only one request is made, and the fallback receives `deadline_exceeded`. Add a success case where `Retry-After: 0.05` fits within a 1,000ms deadline and is retried once.

- [ ] **Step 2: Run client tests to verify they fail**

Run: `npm test -- test/text-transform-client.test.js`

Expected: the new option is ignored and the current client sleeps for the configured Retry-After, causing the deadline assertion to fail.

- [ ] **Step 3: Implement deadline-aware attempt and wait calculations**

Start one deadline clock per request, clip each AbortController timer and retry delay to its remaining milliseconds, and return or throw `deadline_exceeded` when a retry cannot fit. Preserve the existing 429-without-Retry-After no-retry behavior and 5xx backoff+jitter.

- [ ] **Step 4: Run client tests to verify they pass**

Run: `npm test -- test/text-transform-client.test.js`

Expected: deadline, Retry-After, fallback, timeout, response validation, and existing retry tests all pass.

- [ ] **Step 5: Regenerate and check browser artifact**

Run: `npm run build:browser-client` and `npm run check:browser-client`.

Expected: the IIFE contains the same deadline-aware implementation and the stale check passes.

- [ ] **Step 6: Document interactive/background usage**

Document the default 8-second overall deadline and the explicit larger deadline required for background clients in `docs/CLIENT_MIGRATION.md`.

- [ ] **Step 7: Commit**

```sh
git add src/client/text-transform.js scripts/generate-browser-client.mjs src/client/text-transform.iife.js test/text-transform-client.test.js docs/CLIENT_MIGRATION.md docs/API_PLAN.md
git commit -m "Add overall deadline to shared text client"
```

### Task 5: Integrated verification, production release, and records

**Files:**
- Modify: `scripts/smoke-production.mjs`
- Modify: `scripts/deploy-production.mjs`
- Modify: `docs/API_PLAN.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `CHANGELOG.md`
- Create: `docs/releases/<gate timestamp>.json`

- [ ] **Step 1: Run static and generated checks**

Run: `npm run check:text-snapshot`, `node --check scripts/deploy-production.mjs`, and `git diff --check`.

Expected: generated rules, metadata, browser IIFE, deployment script syntax, and whitespace checks pass.

- [ ] **Step 2: Run the complete test suite**

Run: `npm test`.

Expected: zero failures, including Golden, Gateway, metadata, release recovery, and client deadline tests.

- [ ] **Step 3: Run both Worker dry-runs**

Run: `npx wrangler deploy --config wrangler.text-transform.jsonc --dry-run --var TEXT_CORE_SOURCE_REVISION:<current SHA>` and `npx wrangler deploy --config wrangler.jsonc --dry-run` after the private assert.

Expected: Text Worker remains private and both bundles compile with the configured bindings.

- [ ] **Step 4: Execute production release gate**

Run: `npm run deploy:production`.

Expected order: private assert → source SHA capture → build/check/test → dry-runs → active Text Version capture → Text deploy → source／direct URL smoke → Gateway deploy → final smoke → release metadata.

- [ ] **Step 5: Verify production evidence**

Confirm release metadata contains matching `gitRevision`, `sourceRevision`, Text/Gateway Version IDs, direct Text non-200, Gateway batch 200, invalid profile/query 400, body 413, request ID, and CORS contract fields.

- [ ] **Step 6: Update changelog and plan with final IDs**

Record the final JST release time, Version IDs, test count, sourceRevision, and any Cloudflare propagation or rate-limit observations. Leave external client repository edits and Reader work explicitly unchecked.

- [ ] **Step 7: Final verification and push**

Run: `git status --short --branch`, `git log --oneline -8`, and `git status --porcelain`.

Expected: working tree clean, local branch synchronized after pushing the commits and release record to `origin/main`.
