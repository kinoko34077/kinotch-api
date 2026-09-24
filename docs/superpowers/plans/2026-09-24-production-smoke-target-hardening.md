# Production Smoke Target Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure `npm run deploy:production` can smoke only the production Gateway and private Worker endpoints, while preserving environment overrides for standalone local smoke use.

**Architecture:** Keep `scripts/smoke-production.mjs` configurable for explicit local diagnostics, but expose a fixed production target set and pass it from `scripts/deploy-production.mjs` to every release smoke and readiness call. The release gate will never inherit `API_BASE_URL`, `TEXT_DIRECT_URL`, or `COMPRESSION_DIRECT_URL` from the operator environment.

**Tech Stack:** Node.js ESM, Cloudflare Workers, Wrangler, Node test runner, Markdown.

**Spec:** Current production re-audit supplied by the user; existing release authority remains `npm run deploy:production`.

## Global Constraints

- Preserve `/v1/compress`, all existing REST routes, MCP `/mcp`, Worker topology, Service Bindings, rate limits, prompts, models, authentication, rollback, and public response contracts.
- Keep standalone `npm run smoke:production` environment overrides available for local diagnostics.
- Production release smoke must target `https://api.kinotch.workers.dev`, `https://text-transform.kinotch.workers.dev`, and `https://semantic-compression.kinotch.workers.dev` only.
- Do not run `npm run deploy:production` in this task.
- Do not rewrite historical release metadata; document the current release mismatch as an operator deployment state.

## Review Focus

- An operator-provided `API_BASE_URL` must not redirect release smoke away from the deployed Gateway.
- Operator-provided direct Worker URLs must not redirect private Worker checks during release smoke.
- Standalone local smoke must retain its explicit environment override behavior.
- Compression readiness and both profile smoke calls must use the same fixed Gateway target as the final Gateway smoke.
- Release metadata and smoke results must continue to report only safe endpoint/provenance information.

### Task 1: Separate local smoke targets from production release targets

**Files:**
- Modify: `scripts/smoke-production.mjs`
- Modify: `scripts/deploy-production.mjs`
- Test: `test/smoke-production.test.js`
- Test: `test/deploy-production.test.js`

**Interfaces:**
- Export `PRODUCTION_SMOKE_TARGETS` containing the fixed production Gateway, Text Worker, and Compression Worker URLs.
- Export `resolveSmokeTargets(env = process.env)` for standalone local smoke override resolution.
- Accept `targets` on smoke/readiness helpers; release code passes `PRODUCTION_SMOKE_TARGETS` explicitly.

- [x] **Step 1: Add failing target-boundary tests.** Added local override, immutable production target, explicit smoke target, and release source assertions.
- [x] **Step 2: Run focused tests and confirm the release-target assertions fail.** The initial run failed on the missing export/fixed-target implementation after the sandbox Node path restriction was bypassed.
- [x] **Step 3: Implement explicit target resolution.** Moved environment override logic into `resolveSmokeTargets`, defined immutable production targets, and threaded `targets` through request, direct checks, compression smoke, readiness, and full production smoke without changing local defaults.
- [x] **Step 4: Bind deploy production calls.** Text smoke, Compression readiness, both profile smokes, and final Gateway smoke now receive `PRODUCTION_SMOKE_TARGETS` explicitly.
- [x] **Step 5: Run focused tests and inspect the release source.** Focused smoke/deploy tests passed: 24/24.

### Task 2: Document the release target boundary

**Files:**
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/semantic-compression.md`
- No MCP document change required; the MCP production endpoint was already fixed by the preceding hardening change.

- [x] **Step 1: Add current operational wording.** Documented that standalone smoke may use explicit local overrides, but `npm run deploy:production` ignores those overrides and uses the fixed production endpoints.
- [x] **Step 2: Run documentation-focused tests and `git diff --check`.** Documentation and release-authority tests passed; public API contracts were unchanged.

### Task 3: Qualification and delivery

- [x] **Step 1: Run `npm test` and generated snapshot checks.** `npm test` passed: 225 pass, 1 skip, 0 fail across 226 tests.
- [x] **Step 2: Run text, Compression, Gateway, and MCP Wrangler dry-runs.** All four dry-runs passed; no deploy or production smoke was run.
- [x] **Step 3: Confirm Text Core and generated snapshots are unchanged.** Scoped diff was empty and `git diff --check` passed.
- [ ] **Step 4: Commit, push, and verify GitHub CI/Verify for the final SHA.** Keep Production deploy explicitly unexecuted.
