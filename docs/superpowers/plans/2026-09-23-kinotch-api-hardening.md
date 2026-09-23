# kinotch-api Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve the existing kinotch-api contracts while strengthening compression prompt boundaries, integrity warnings, production source revision gating, deploy authority, and privacy settings.

**Architecture:** Keep Gateway, semantic-compression, Text Core, and MCP responsibilities unchanged. Add shared prompt-boundary composition and a mechanical integrity detector inside the compression Worker, enforce `main == origin/main` at the production release boundary, remove the normal direct Text Worker deploy path, and disable Text Worker automatic invocation logs.

**Tech Stack:** Cloudflare Workers, Wrangler, JavaScript ESM, Node test runner, Gemini Interactions API.

**Spec:** User-provided `kinotch-api 現行版 Hardening 修正指示書`.

## Global Constraints

- Preserve `/v1/compress`, existing routes, public profiles, model, thinking level, `store:false`, Service Bindings, auth, limits, hashes, counts, rollback order, and Text Core behavior.
- Do not automatically deploy to Production; commit, push, verify CI and dry-runs only.
- Do not log source text, compressed text, credentials, system prompts, or provider raw responses.
- Integrity warnings are fixed enum names only and must never contain source markers or free-form text.
- Marker detection is mechanical evidence, not semantic equivalence proof and must not automatically replace output with the original input.
- Production release must require branch `main` and `HEAD == origin/main` after a successful `git fetch origin main`.

## Review Focus

- Quoted or adversarial instructions remain data and do not alter provider settings; test prompt-boundary composition and fixed request fields.
- Missing or transformed numbers, URLs, SHAs, paths, IDs, percentages, dates, and negations produce safe enum warnings without leaking marker values.
- A clean but unpushed branch, stale `origin/main`, or fetch failure cannot reach a Production deploy.
- Normal package scripts cannot bypass the release gate with a direct Text Worker deploy.
- Text invocation logs remain disabled while custom safe observability remains available.

### Task 1: Prompt Boundary and Integrity Warnings

**Files:**
- Modify: `src/semantic-compression/prompt.js`
- Modify: `src/semantic-compression/gemini.js`
- Create: `src/semantic-compression/integrity.js`
- Modify: `src/semantic-compression/contract.js`
- Test: existing semantic-compression prompt/provider/worker tests plus new integrity tests
- Modify: prompt metadata tests/docs if hashes or token metadata change

**Interfaces:**
- `buildProductionSystemInstruction(profile)` returns the shared service boundary followed by the selected fixed profile prompt.
- `inspectCompressionIntegrity(inputText, compressedText)` returns `{ warnings: string[] }` using only fixed warning enum values.
- The Gemini adapter receives the composed system instruction without changing the public request/response schema.

- [ ] Write failing tests for both profiles using the shared boundary, fixed generation settings, and no caller-controlled prompt fields.
- [ ] Write failing integrity tests for marker retention, missing URL/SHA/number/negation, unknown-field value fabrication, and warning privacy.
- [ ] Implement the smallest shared prompt composition and detector using Unicode-safe marker extraction.
- [ ] Keep public profile names, prompt versions, model, and response fields unchanged; update metadata only when prompt bytes actually change.
- [ ] Run focused compression tests and then `npm test`.

### Task 2: Production Git Revision Gate

**Files:**
- Modify: `scripts/deploy-production.mjs`
- Create or modify: release-gate helper under `scripts/`
- Test: production deploy gate tests

**Interfaces:**
- `assertProductionSourceRevision({ runGit, expectedBranch: "main" })` fetches `origin main`, verifies branch, local HEAD, and `origin/main`, and fails closed on any command failure.

- [ ] Write failing tests for non-main branch, local/remote mismatch, fetch failure, and matching clean source.
- [ ] Implement the gate at the start of `npm run deploy:production` before Worker deploys.
- [ ] Avoid adding GitHub API credentials or a generic GitHub client.
- [ ] Run focused gate tests and `node --check scripts/deploy-production.mjs`.

### Task 3: Deploy Authority and Invocation Privacy

**Files:**
- Modify: `package.json`
- Modify: `scripts/` only if an emergency path is retained
- Modify: `wrangler.text-transform.jsonc`
- Modify: Text invocation-log configuration tests/docs

**Interfaces:**
- Normal Production deploy remains only `npm run deploy:production`.
- If a Text-only path remains, it is `emergency:deploy:text-transform` and requires `ALLOW_EMERGENCY_DIRECT_DEPLOY=true`.

- [ ] Write failing tests for normal script exposure and emergency-flag enforcement if applicable.
- [ ] Remove or rename `deploy:text-transform`; do not change Worker runtime behavior.
- [ ] Set Text Worker `invocation_logs: false` and pin the setting in tests.
- [ ] Update operations docs to prohibit direct unverified main pushes and normal direct Worker deploys.

### Task 4: Re-evaluation, Dry-runs, and Delivery

**Files:**
- Modify: existing evaluation/docs only where required by the final behavior
- Local-only: quality evaluation artifacts under ignored `artifacts/`

- [ ] Run the existing synthetic semantic compression evaluation for both public profiles, focusing on negation, prohibition, injection-like text, empty fields, URL/SHA/path/ID, numbers, conditions, exceptions, and fact/inference boundaries.
- [ ] Run `npm test`, `git diff --check`, and all requested Worker dry-runs.
- [ ] Verify no Text Core or generated snapshot changes.
- [ ] Commit by reason, push to `origin/main`, and verify GitHub Actions `test` succeeds.
- [ ] Do not run `npm run deploy:production`; report any live Gemini or Production checks separately.
