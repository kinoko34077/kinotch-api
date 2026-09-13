# Semantic Compression Residual Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin Gemini 3.5 Flash-Lite compression to `thinking_level: "minimal"`, add opt-in synthetic quality and safe usage evaluation tooling, and verify the external production-release boundaries without changing the public Compression API or `dev_agent`.

**Architecture:** Keep the existing fixed Compression contract and Gemini Interactions adapter as the production path. Add the thinking level to the existing contract source of truth, pass it only from the adapter, and expose optional numeric usage through a test/evaluation callback that is absent from the production Worker. Keep quality evaluation and usage measurement as separate opt-in scripts using synthetic inputs and the existing Worker app boundary.

**Tech Stack:** Cloudflare Worker JavaScript, Google Gemini Interactions API, Node.js built-in test runner, JSON fixtures, Markdown operations documentation, Wrangler/GitHub/Cloudflare authenticated control planes.

**Spec:** User-provided `kinotch-api Semantic Compression 残作業・検証指示書` (2026-09-13).

## Global Constraints

- Fixed model remains exactly `gemini-3.5-flash-lite`.
- Fixed thinking setting is exactly `generation_config.thinking_level = "minimal"`.
- Do not add `temperature`, `top_p`, `top_k`, `thinking_budget`, tools, search, history, background, or explicit cache.
- Keep `semantic-dense-v1`, its Prompt text, public `/v1/compress` request/response fields, `store:false`, auth, limits, timeouts, retry policy, Service Binding, Gateway, Text Core, and `dev_agent` unchanged.
- Local live/evaluation credential is `KINOTCH_COMPRESSION_GEMINI_API_KEY`; Worker binding remains `GEMINI_API_KEY`; no fallback.
- Production authority remains `npm run deploy:production`; do not run it before Cloudflare auto-deploy is confirmed disabled and required operator credentials are available.
- Never log or persist input text, compressed text, Prompt, API keys, caller tokens, or raw provider responses in production or usage measurement output.
- Do not invent quality or cache thresholds; record baseline observations only.

---

### Task 1: Pin the fixed Gemini thinking level

**Files:**
- Modify: `src/semantic-compression/contract.js`
- Modify: `src/semantic-compression/gemini.js`
- Modify: `src/semantic-compression-worker.js`
- Modify: `test/semantic-compression-contract.test.js`
- Modify: `test/semantic-compression-worker.test.js`
- Modify: `test/compression-api.test.js`
- Modify: `docs/semantic-compression.md`

**Interfaces:**
- Produces `COMPRESSION_THINKING_LEVEL = "minimal"` from the existing Compression contract module.
- `requestGeminiCompression()` sends `generation_config: { thinking_level: COMPRESSION_THINKING_LEVEL }` and no other sampling/thinking setting.

- [x] **Step 1: Add the failing contract assertion**

  Import `COMPRESSION_THINKING_LEVEL` in `test/semantic-compression-contract.test.js` and assert:

  ```js
  assert.equal(COMPRESSION_THINKING_LEVEL, "minimal");
  ```

- [x] **Step 2: Add failing request-shape assertions**

  In the existing fixed-request tests, assert `generation_config.thinking_level`, `store:false`, and that `temperature`, `top_p`, `top_k`, and `thinking_budget` are `undefined`.

- [x] **Step 3: Run focused tests and observe the expected failure**

  Run `npm test -- test/semantic-compression-contract.test.js test/semantic-compression-worker.test.js test/compression-api.test.js` and confirm the new assertions fail because the constant/request field is absent.

- [x] **Step 4: Add the single contract constant**

  Add:

  ```js
  export const COMPRESSION_THINKING_LEVEL = "minimal";
  ```

  beside the existing fixed profile, prompt version, and model constants.

- [x] **Step 5: Send only the fixed generation config**

  Import the constant in `gemini.js` and add this member to the existing Interactions request body:

  ```js
  generation_config: { thinking_level: COMPRESSION_THINKING_LEVEL },
  ```

  Do not add any other generation parameter.

- [x] **Step 6: Run focused tests and the full suite**

  Run the focused command, then `npm test` in the permitted native environment. Confirm the existing public response key assertions remain unchanged.

- [x] **Step 7: Document the fixed internal setting**

  Update the fixed Provider section to state that `gemini-3.5-flash-lite` uses `generation_config.thinking_level = "minimal"` internally, while the public contract has no thinking field. Keep the existing no-tools, stateless, and `store:false` statements.

- [x] **Step 8: Commit the isolated change**

  Run `git diff --check`, confirm `src/text-core` is unchanged, and commit as `feat: pin compression thinking level to minimal`.

---

### Task 2: Add a synthetic real-model quality evaluation path

**Files:**
- Create: `test/fixtures/semantic-compression-quality.json`
- Create: `scripts/evaluate-compression.mjs`
- Create: `test/semantic-compression-quality-evaluation.test.js`
- Modify: `package.json`
- Modify: `docs/semantic-compression.md`
- Modify: `docs/OPERATIONS.md`

**Interfaces:**
- The fixture contains 50 synthetic cases with stable `id`, `category`, and `input` fields; it contains no private repository text or secrets.
- `npm run evaluate:compression` requires `RUN_COMPRESSION_QUALITY_EVAL=true` and `KINOTCH_COMPRESSION_GEMINI_API_KEY`; without both it exits before any external request.
- The evaluator calls `createCompressionWorkerApp()` with the dedicated local key, validates every response with `validateCompressionPayload()`, and writes optional human-review records only when `COMPRESSION_QUALITY_OUTPUT` is explicitly supplied.

- [x] **Step 1: Add the fixture contract test first**

  Assert the fixture has exactly 50 entries, unique IDs, all required categories, and mandatory synthetic markers for numbers, dates, URLs, SHA, paths, negation, conditions, exceptions, comparisons, uncertainty, fact/speculation, chronology, and prompt-injection-as-data.

- [x] **Step 2: Run the fixture contract test** (the fixture was added in the same patch, so an isolated missing-fixture RED run was not performed)

  Run `npm test -- test/semantic-compression-quality-evaluation.test.js` and confirm it fails because the fixture does not exist.

- [x] **Step 3: Add 50 synthetic corpus entries**

  Include representative Japanese inputs only. Use public-looking placeholders such as `https://example.test/...`, a non-secret 40-character hexadecimal commit marker, and paths under `src/`. Do not use real repository content or credentials.

- [x] **Step 4: Implement evaluator guards and response validation**

  Before constructing the Worker app, require the explicit flag and dedicated key. For each fixture, call the existing Worker app, validate status 200 and the existing response contract, and collect only the synthetic `input`, returned `compressed_text`, provenance, and machine-checkable marker results for the optional review file.

- [x] **Step 5: Implement marker-preservation checks without semantic overclaiming**

  Check exact presence of fixture-declared numeric/date/URL/SHA/path/required-token markers in `compressed_text`. Record failures as observations; do not assign an overall semantic pass threshold. Do not auto-judge causality, negation scope, uncertainty, or fact/speculation boundaries.

- [x] **Step 6: Add the opt-in package script and documentation**

  Add `"evaluate:compression": "node scripts/evaluate-compression.mjs"`. Document the explicit flag/key command, synthetic-only corpus, optional output file, no automatic `npm test` execution, and the fact that the result is a baseline for human review rather than a quality guarantee.

- [x] **Step 7: Run non-live tests**

  Run the fixture contract test and `npm test`; confirm no Gemini request occurs during normal tests.

- [x] **Step 8: Commit the evaluation tooling**

  Run `git diff --check`, confirm production source and `src/text-core` are unchanged except Task 1 files, and commit as `test: add semantic compression quality evaluation corpus`.

---

### Task 3: Add safe numeric usage measurement

**Files:**
- Modify: `src/semantic-compression/gemini.js`
- Modify: `src/semantic-compression-worker.js`
- Create: `scripts/measure-compression-usage.mjs`
- Create: `test/semantic-compression-usage.test.js`
- Modify: `package.json`
- Modify: `docs/semantic-compression.md`
- Modify: `docs/OPERATIONS.md`

**Interfaces:**
- `requestGeminiCompression(text, { onUsage })` invokes the optional callback with only numeric `inputTokens`, `outputTokens`, `thoughtTokens`, `cachedTokens`, and `totalTokens`; absent provider fields are `null`.
- `createCompressionWorkerApp({ onUsage })` passes the callback only for tests/evaluation. The production app is created without it and does not expose usage in the API response or logs.
- `npm run measure:compression:usage` requires `RUN_COMPRESSION_USAGE_MEASURE=true` and `KINOTCH_COMPRESSION_GEMINI_API_KEY`; it sends four short `system-only` requests and four synthetic `shared-input-prefix` requests, then prints numeric observations only.

- [x] **Step 1: Add failing usage normalization tests**

  Test a fake completed Interactions payload with all five documented usage fields, missing optional fields, malformed/non-numeric values, and a response body that contains no usage data in the public Worker response.

- [x] **Step 2: Run the focused usage test and observe failure**

  Run `npm test -- test/semantic-compression-usage.test.js` and confirm the callback/normalizer is not yet present.

- [x] **Step 3: Implement bounded usage normalization**

  Read only `payload.usage`. Convert non-negative integer fields to the five camelCase numeric keys and use `null` for absent/invalid fields. Never pass the raw payload to the callback.

- [x] **Step 4: Thread the optional callback through the Worker**

  Add `onUsage` to the existing test/evaluation injection options and pass it to the Gemini adapter. Keep the production app construction unchanged and keep public response keys exactly as before.

- [x] **Step 5: Implement the explicit usage measurement script**

  Build a short no-common-prefix `system-only` set and a synthetic common prefix in memory for `shared-input-prefix`, send four requests per scenario through the Worker app, collect only status and normalized usage numbers, and print JSON records containing no input/output text. Do not encode a cache threshold; report `cachedTokens` as observed, including zero/null.

- [x] **Step 6: Add package script and operations guidance**

  Add `"measure:compression:usage": "node scripts/measure-compression-usage.mjs"`. Document that it is external and potentially billable, requires both explicit flag and dedicated key, measures stateless Interactions only, and does not enable explicit cache or `generateContent`.

- [x] **Step 7: Run focused and full non-live tests**

  Run the usage-focused test and `npm test`; confirm normal tests do not call Gemini and the public contract is unchanged.

- [x] **Step 8: Commit the safe usage tooling**

  Run `git diff --check`, confirm no raw text/secret logging path was added, and commit as `test: expose safe compression usage measurements`.

---

### Task 4: Verify external release boundaries and decide production qualification

**Files:**
- No repository source changes unless an existing documentation status is factually stale.
- Evidence: GitHub branch protection UI/API, Cloudflare `api` Worker Settings, local environment presence checks, and release output if safely executable.

**Interfaces:**
- GitHub `main` must show required `test`, force push disabled, and deletion disabled; PR requirement remains optional and is not added here.
- Cloudflare `api` Worker Settings must show Git integration disconnected / Connect available; no production deploy is triggered for this verification.
- Production release may run only if Cloudflare auto-deploy is confirmed disabled, the dedicated Worker secret and caller smoke token are present, and the operator has accepted the external cost/deploy boundary.

- [ ] **Step 1: Verify GitHub protection after authentication**

  Confirm the saved rule for `main` shows required `test`, `allows_force_pushes = false`, and `allows_deletions = false`. Record any unavailable API/UI evidence as operator-only rather than guessing.

- [ ] **Step 2: Verify Cloudflare Workers Builds state**

  In the authenticated Cloudflare dashboard, confirm `api` no longer shows the connected Git repository and shows `接続`/Connect. Do not click deploy or reconnect.

- [ ] **Step 3: Check local credential presence without printing values**

  Check only whether `KINOTCH_COMPRESSION_GEMINI_API_KEY`, `RUN_GEMINI_LIVE_TEST`, and `COMPRESSION_SMOKE_TOKEN` are non-empty in the current process. Never echo values.

- [ ] **Step 4: Run the opt-in live test only when explicitly enabled and credentialed**

  If both dedicated live flag and key are present, run `npm run test:compression:live` and record its actual result. Otherwise record `live test: not run — credential unavailable in execution environment`.

- [ ] **Step 5: Run production release only when all prerequisites are evidenced**

  If Cloudflare is disconnected, worktree is clean, tests pass, and `COMPRESSION_SMOKE_TOKEN` is present, run `npm run deploy:production` exactly once and capture its release metadata, smoke, and rollback evidence. Otherwise do not deploy and report the exact remaining operator-only prerequisite.

- [ ] **Step 6: Final verification**

  Run `npm test`, `git diff --check`, `git status`, and `git diff --stat`; verify no `src/text-core` changes, no public API field changes, and no untracked live output is included.

---
