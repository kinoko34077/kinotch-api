# Compression Provenance, Release Secret, and MCP Body Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three confirmed P1 hardening findings without changing the public profile names, compression behavior, or production deployment authority.

**Architecture:** Version the two production System Instructions independently from their public profiles, sanitize release child-process environments by default while explicitly allowing only Wrangler credentials for Cloudflare commands, and reject oversized MCP HTTP bodies after Access JWT verification but before the Streamable HTTP framework parses them. Keep the existing Compression Worker as the only Gemini/Prompt authority.

**Tech Stack:** JavaScript ESM, Node test runner, Hono/Cloudflare Workers, Wrangler, MCP Streamable HTTP.

**Spec:** Current audit supplied in the user request; existing contracts at `src/semantic-compression/contract.js`, `src/semantic-compression/prompt.js`, `src/semantic-compression-mcp-worker.js`, and `scripts/deploy-production.mjs`.

## Global Constraints

- Keep public profiles exactly `compact-v1` and `semantic-dense-v1`.
- Use prompt versions `compact-v1.1` and `semantic-dense-v1.1` for the current Service Boundary + profile prompt bytes.
- Keep `gemini-3.5-flash-lite`, `thinking_level: minimal`, `store: false`, fixed prompts, Service Bindings, and provider retry policy unchanged.
- Do not expose REST `COMPRESSION_API_TOKEN` through MCP or forward MCP authentication downstream.
- Keep the existing 200,000 Unicode code-point provider safety limit and 2.5 MiB Compression body limit as the shared basis for MCP transport protection.
- Do not send `MCP_SMOKE_ACCESS_COOKIE`, `COMPRESSION_SMOKE_TOKEN`, Gemini credentials, or local live-test credentials to `npm ci`, tests, build scripts, or snapshot generators.
- Do not perform a Production deploy in this task.
- Do not edit Text Core, generated text snapshots, or Base-managed workflow files.

## Review Focus

- A response for either profile must expose the prompt version mapped to the exact production System Instruction, and MCP validation/smoke must use that mapping instead of assuming profile and prompt version are equal.
- `npm ci`, lifecycle scripts, tests, and build tools must not inherit release cookies, caller smoke tokens, Gemini keys, or Cloudflare credentials; Wrangler commands must still receive only the credentials needed to operate.
- An authenticated MCP request whose `Content-Length` is too large must be rejected before the MCP handler; a forged smaller `Content-Length` must still be caught by reading the cloned stream.
- A request rejected by the MCP body guard must not call the Service Binding or consume the original body before the handler receives an allowed request.
- Existing REST success/error contracts and both MCP initialize/tool paths must remain unchanged apart from the intentional prompt-version provenance update.

### Task 1: Version production Prompt provenance

**Files:**
- Modify: `src/semantic-compression/contract.js`
- Modify: `src/semantic-compression/prompt.js`
- Modify: `src/semantic-compression/prompt-metadata.js`
- Modify: `src/semantic-compression-mcp/contract.js`
- Modify: `scripts/smoke-production.mjs`
- Modify: `scripts/smoke-mcp.mjs`
- Modify: `scripts/deploy-production.mjs`
- Test: `test/semantic-compression-contract.test.js`, `test/semantic-compression-mcp-contract.test.js`, `test/semantic-compression-mcp-upstream.test.js`, `test/semantic-compression-mcp-worker.test.js`, `test/smoke-production.test.js`, `test/smoke-mcp.test.js`, `test/semantic-compression-live.test.js`
- Modify: current Compression/MCP specification and operations documents that state `prompt_version` equals the profile.

**Interfaces:**
- Produce `COMPRESSION_PROMPT_VERSION_COMPACT = "compact-v1.1"`, `COMPRESSION_PROMPT_VERSION_SEMANTIC_DENSE = "semantic-dense-v1.1"`, and a profile-to-prompt-version resolver in the shared Compression contract.
- Make `resolveCompressionProfile(profile)` return the corresponding version while retaining the existing profile and System Instruction fields.
- Make MCP expose `MCP_EXPECTED_PROMPT_VERSION` from the semantic-dense prompt-version constant.

- [x] **Step 1: Write failing provenance assertions.** Update focused tests so compact and semantic responses expect their `.1` prompt versions, resolve the new mapping, and reject an upstream MCP payload using the profile name as its prompt version.
- [x] **Step 2: Run the focused tests and confirm they fail for the old mapping.** Run `node --test test/semantic-compression-contract.test.js test/semantic-compression-mcp-contract.test.js test/semantic-compression-mcp-upstream.test.js test/smoke-production.test.js test/smoke-mcp.test.js` and confirm the failures identify stale profile-equals-version assumptions.
- [x] **Step 3: Implement the shared version mapping.** Add the two constants and resolver, return them from `resolveCompressionProfile`, use the semantic-dense version as the default response version, and add the version beside each prompt hash/token metadata record.
- [x] **Step 4: Update dependent smoke, MCP, release metadata, and documentation paths.** Replace hard-coded prompt-version comparisons with shared constants or profile resolution; keep profile values unchanged and update current docs only.
- [x] **Step 5: Run focused tests and inspect the public contract.** Confirm both profiles, MCP upstream validation, smoke validation, and response builders pass with distinct profile/version values.
- [x] **Step 6: Commit the provenance change.** The combined hardening commit `c15a100` includes the provenance change after the focused tests passed.

### Task 2: Sanitize Production release child environments

**Files:**
- Create: `scripts/release-child-env.mjs`
- Modify: `scripts/deploy-production.mjs`
- Create/Modify: `test/release-child-env.test.js`, `test/deploy-production.test.js`

**Interfaces:**
- Produce `createReleaseChildEnv(sourceEnv, { includeCloudflareCredentials })`, which removes release-only secret names by default and restores only Wrangler credential names when explicitly requested.
- Make `run()` use the sanitized environment by default and add a single Wrangler execution helper/path that opts into Cloudflare credentials without restoring smoke cookies, smoke tokens, Gemini keys, or live-test keys.

- [x] **Step 1: Write failing environment-isolation tests.** Assert that a fixture environment containing `MCP_SMOKE_ACCESS_COOKIE`, `COMPRESSION_SMOKE_TOKEN`, `GEMINI_API_KEY`, `KINOTCH_COMPRESSION_GEMINI_API_KEY`, and Cloudflare credentials loses all of them by default; assert Wrangler mode keeps only the Cloudflare credential names.
- [x] **Step 2: Run the new test and confirm it fails because no sanitizer exists.** Run `node --test test/release-child-env.test.js` and record the expected missing-module or missing-export failure.
- [x] **Step 3: Implement the pure sanitizer.** Add explicit secret-name lists and return a copied environment without mutating `process.env`; keep non-secret operational variables intact.
- [x] **Step 4: Integrate the sanitizer into deploy execution.** Default every child process to the sanitized environment, pass Cloudflare credentials only to Wrangler status/dry-run/deploy/rollback commands, and leave parent-process smoke calls unchanged.
- [x] **Step 5: Add release-source assertions.** Pin tests to the default sanitized `run()` path, explicit Wrangler credential path, and absence of raw `env: process.env` forwarding.
- [x] **Step 6: Run focused release tests and commit.** Focused release tests passed; the combined hardening commit `c15a100` includes the child-environment isolation.

### Task 3: Add the MCP pre-parse body guard

**Files:**
- Modify: `src/semantic-compression/contract.js`
- Modify: `src/policies/routes.js`
- Create: `src/semantic-compression-mcp/body-limit.js`
- Modify: `src/semantic-compression-mcp-worker.js`
- Test: `test/semantic-compression-mcp-worker.test.js`, `test/semantic-compression-mcp-contract.test.js`, `test/compression-api.test.js`
- Modify: `docs/specs/semantic-compression-mcp.md`, `docs/semantic-compression-mcp.md`, `docs/USAGE.md`

**Interfaces:**
- Produce shared `COMPRESSION_BODY_LIMIT_BYTES = 2.5 * 1024 * 1024` used by the REST Compression policy and MCP transport guard.
- Produce `inspectMcpBodyLimit(request, limitBytes)` returning a safe `{ ok: true }` or `{ ok: false, code }` result without consuming the original request body.

- [x] **Step 1: Write failing guard tests.** Assert an authenticated MCP request with an oversized declared `Content-Length` returns 413 before the handler; assert a request whose declared length is small but whose stream exceeds the limit is also rejected, and that the Service Binding is not called.
- [x] **Step 2: Run the focused worker tests and confirm they fail.** Run `node --test test/semantic-compression-mcp-worker.test.js test/semantic-compression-mcp-contract.test.js` and confirm the oversized request currently reaches the injected handler.
- [x] **Step 3: Implement the shared byte-limit constant and cloned-stream inspection.** Reject safe oversized `Content-Length` values immediately; otherwise read only a cloned body stream, stop and cancel at the first byte over the limit, and return `invalid_body` on read failure.
- [x] **Step 4: Insert the guard after Access JWT verification and before `createMcpHandler`.** Map `payload_too_large` to 413 and `invalid_body` to 400 without logging or returning request content.
- [x] **Step 5: Run focused REST/MCP tests and commit.** REST/MCP tests passed with the shared 2.5 MiB policy; the combined hardening commit `c15a100` includes the pre-parse guard.

### Task 4: Re-run qualification evidence and close the change

**Files:**
- Modify: this plan checklist and any current docs whose prompt-version/limit statements changed.

- [x] **Step 1: Run all generated checks and `npm test`.** Confirm no generated files drift and all existing tests pass; live Gemini remains opt-in.
- [x] **Step 2: Run the three Worker dry-runs.** Run the text, Compression, and Gateway Wrangler dry-runs plus the MCP dry-run with operator vars only if available; do not deploy.
- [x] **Step 3: Run `git diff --check` and scope checks.** Confirm only intended source/tests/docs/plan files changed; Text Core and generated snapshots remain unchanged.
- [x] **Step 4: Run opt-in live quality evaluation only if the dedicated key exists.** If `KINOTCH_COMPRESSION_GEMINI_API_KEY` is absent, record that the live quality evidence was not run; never use `GEMINI_API_KEY` as fallback and do not invent a PASS.
- [x] **Step 5: Commit/push the final changes and verify CI/Verify.** `c15a100` was pushed; `HEAD == origin/main`, the worktree is clean, and GitHub CI/Verify both completed successfully. `npm run deploy:production` was not run.
