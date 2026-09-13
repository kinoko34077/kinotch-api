# Compression Live-Test Environment Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make kinotch-api's local Gemini live test read only `KINOTCH_COMPRESSION_GEMINI_API_KEY` while preserving the Cloudflare Worker `GEMINI_API_KEY` binding.

**Architecture:** Keep the Worker contract unchanged. Put live-test environment resolution in a test-only helper that fails fast when the explicit live flag is set without the dedicated key; pass the resolved key to the Worker only as `{ GEMINI_API_KEY: ... }`. Update only local live-test documentation and leave Cloudflare secret instructions intact.

**Tech Stack:** Node.js built-in test runner, ES modules, Markdown documentation, PowerShell operator commands.

**Spec:** User-provided `kinotch-api Geminiローカル環境変数分離 修正指示書` (2026-09-13)

## Global Constraints

- Current `origin/main` at task start is the source of truth; do not assume a prior SHA.
- Local live test credential is exactly `KINOTCH_COMPRESSION_GEMINI_API_KEY`.
- `GEMINI_API_KEY` remains the Cloudflare `semantic-compression` Worker secret binding.
- No fallback from `GEMINI_API_KEY` to the local live-test credential.
- `npm test` must not call Gemini; the live test remains opt-in.
- Do not modify `/v1/compress`, semantic-dense-v1, Gemini model/adapter/API, Service Binding, rate limits, context limits, deploy/rollback, Gateway, Text Core, or `dev_agent`.
- Do not run the live Gemini test without an operator-supplied credential.

---

### Task 1: Lock the local credential-selection behavior with tests

**Files:**
- Create: `test/semantic-compression-live-config.test.js`
- Create: `test/semantic-compression-live-config.js`

**Interfaces:**
- Consumes: An environment-like object with optional `RUN_GEMINI_LIVE_TEST` and `KINOTCH_COMPRESSION_GEMINI_API_KEY` values.
- Produces: `resolveLiveGeminiConfig(env)` returning `{ shouldRun: boolean, apiKey: string | undefined }`, or throwing the exact missing-key error when the flag is true without the dedicated key.

- [x] **Step 1: Write the failing behavior tests**

  Cover three cases: both old and new names exist and the new value wins; only the old `GEMINI_API_KEY` exists with the flag set and the resolver throws without revealing the old value; neither flag nor new key is active and the resolver returns `shouldRun:false`.

- [x] **Step 2: Run the focused test to verify the expected missing-helper failure**

  Run: `node --test test/semantic-compression-live-config.test.js`

  Expected: FAIL because `test/semantic-compression-live-config.js` does not exist yet.

- [x] **Step 3: Implement the minimal test-only resolver**

  Read only `env.RUN_GEMINI_LIVE_TEST` and `env.KINOTCH_COMPRESSION_GEMINI_API_KEY`. When the flag is `true` and the dedicated value is not a non-empty string, throw `KINOTCH_COMPRESSION_GEMINI_API_KEY is required when RUN_GEMINI_LIVE_TEST=true`. Never read `env.GEMINI_API_KEY`.

- [x] **Step 4: Run the focused test to verify it passes**

  Run: `node --test test/semantic-compression-live-config.test.js`

  Expected: PASS for all resolver cases.

### Task 2: Wire the live test to the dedicated local variable

**Files:**
- Modify: `test/semantic-compression-live.test.js`

**Interfaces:**
- Consumes: `resolveLiveGeminiConfig(process.env)` from `test/semantic-compression-live-config.js`.
- Produces: An opt-in live test that passes the resolved dedicated credential to `createCompressionWorkerApp()` only through the unchanged Worker binding `{ GEMINI_API_KEY: liveGemini.apiKey }`.

- [x] **Step 1: Replace the module-level environment decision**

  Use the resolver for `shouldRun` and `apiKey`; register the live test normally when `shouldRun` is true and with `test.skip` otherwise. With the flag true and the dedicated key absent, module evaluation must fail with the safe missing-key message before any provider request.

- [x] **Step 2: Run the live test in its normal no-flag mode**

  Run: `node --test test/semantic-compression-live.test.js`

  Expected: the live test is skipped and no Gemini request is made.

- [x] **Step 3: Run the explicit-flag missing-key case without a provider call**

  Run in PowerShell with no `KINOTCH_COMPRESSION_GEMINI_API_KEY`:

  ```powershell
  $env:RUN_GEMINI_LIVE_TEST = "true"
  Remove-Item Env:KINOTCH_COMPRESSION_GEMINI_API_KEY -ErrorAction SilentlyContinue
  node --test test/semantic-compression-live.test.js
  Remove-Item Env:RUN_GEMINI_LIVE_TEST
  ```

  Expected: FAIL with `KINOTCH_COMPRESSION_GEMINI_API_KEY is required when RUN_GEMINI_LIVE_TEST=true`; no secret value or external Gemini request is printed or made.

### Task 3: Update local live-test documentation without changing Worker secret docs

**Files:**
- Modify: `docs/semantic-compression.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-13-semantic-compression-api.md`
- Modify: `docs/superpowers/plans/2026-09-13-semantic-compression-production-hardening.md`
- Modify: `docs/superpowers/specs/2026-09-13-semantic-compression-design.md`
- Modify: `test/semantic-compression-docs.test.js`

**Interfaces:**
- Consumes: The unchanged Cloudflare command `wrangler secret put GEMINI_API_KEY --config wrangler.semantic-compression.jsonc`.
- Produces: Documentation that distinguishes local `KINOTCH_COMPRESSION_GEMINI_API_KEY` from Worker `GEMINI_API_KEY` and contains no stale local `$env:GEMINI_API_KEY` live-test command.

- [x] **Step 1: Add failing documentation assertions**

  Require `KINOTCH_COMPRESSION_GEMINI_API_KEY` in the documented corpus and assert that the old PowerShell local assignment `$env:GEMINI_API_KEY` is absent from the operational documents.

- [x] **Step 2: Run the focused documentation test to verify it fails**

  Run: `node --test test/semantic-compression-docs.test.js`

  Expected: FAIL because the current live-test instructions still use `$env:GEMINI_API_KEY` and do not name the dedicated local variable.

- [x] **Step 3: Update only local live-test instructions**

  Document:

  ```powershell
  $env:KINOTCH_COMPRESSION_GEMINI_API_KEY = "<operator-provided Gemini key>"
  $env:RUN_GEMINI_LIVE_TEST = "true"
  npm run test:compression:live
  Remove-Item Env:KINOTCH_COMPRESSION_GEMINI_API_KEY
  Remove-Item Env:RUN_GEMINI_LIVE_TEST
  ```

  Keep `wrangler secret put GEMINI_API_KEY --config wrangler.semantic-compression.jsonc`, `c.env.GEMINI_API_KEY`, and Worker fixture examples unchanged. Add the short README pointer and update only live-test sentences in the historical plan/spec records.

- [x] **Step 4: Run the focused documentation test to verify it passes**

  Run: `node --test test/semantic-compression-docs.test.js`

  Expected: PASS, including existing secret placeholder checks.

### Task 4: Full verification and checkpoint push

**Files:**
- Verify only: `package.json`, `src/semantic-compression-worker.js`, `src/semantic-compression`, `src/text-core`, `scripts/deploy-production.mjs`, `scripts/smoke-production.mjs`.

**Interfaces:**
- Consumes: The dedicated local test environment contract and existing Worker contract.
- Produces: Fresh regression evidence and a commit containing only local live-test isolation, documentation, and tests.

- [x] **Step 1: Run the complete normal suite**

  Run: `npm test`

  Expected: all tests pass with the intentional live-test skip; no external Gemini call occurs.

- [x] **Step 2: Verify environment-name scope and protected implementation stability**

  Run: `rg -n --hidden -g '!node_modules' -g '!.git' "process\.env\.GEMINI_API_KEY|\$env:GEMINI_API_KEY" .` and `git diff --check`.

  Expected: no local live-test read/assignment uses the old variable; remaining `GEMINI_API_KEY` matches are Worker binding, secret setup, fixtures, or internal adapter contract. `git diff --check` exits successfully.

- [x] **Step 3: Verify protected paths have no diff**

  Run: `git diff --name-only origin/main -- src/text-core src/semantic-compression src/semantic-compression-worker.js scripts/deploy-production.mjs scripts/smoke-production.mjs wrangler.semantic-compression.jsonc package.json`.

  Expected: no paths are printed except none; `package.json` remains unchanged because the live-test script name is unchanged.

- [ ] **Step 4: Commit and push the isolated change**

  Run:

  ```powershell
  git add test/semantic-compression-live.test.js test/semantic-compression-live-config.js test/semantic-compression-live-config.test.js test/semantic-compression-docs.test.js docs/semantic-compression.md README.md docs/superpowers/plans/2026-09-13-compression-live-env-isolation.md docs/superpowers/plans/2026-09-13-semantic-compression-api.md docs/superpowers/plans/2026-09-13-semantic-compression-production-hardening.md docs/superpowers/specs/2026-09-13-semantic-compression-design.md
  git commit -m "test: isolate compression live-test credential"
  git push origin main
  ```

  Expected: `origin/main` advances with this commit only; no production deploy command is invoked.
