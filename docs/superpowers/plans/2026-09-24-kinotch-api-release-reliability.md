# kinotch-api Release Reliability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the remaining non-fatal release reliability and operational hardening findings without changing the public API, Worker topology, or compression behavior.

**Architecture:** Keep the existing Gateway, semantic-compression, and MCP boundaries intact. Bind normal MCP release smoke to the production Worker hostname, reinstall the lockfile-defined dependency tree before release checks, make rate-limit identity fail closed when Cloudflare's client IP header is absent, separate MCP prompt-version metadata from the profile constant, and improve safe smoke diagnostics. Pin the Verify workflow's checkout action and update the repository state documentation.

**Tech Stack:** Cloudflare Workers, Wrangler, Node.js ESM, Node test runner, GitHub Actions, Markdown.

**Spec:** User-provided production re-audit findings for `kinoko34077/kinotch-api`.

## Global Constraints

- Preserve `/v1/compress`, MCP `/mcp`, existing profiles, model, prompts, auth, rate limits, Service Bindings, rollback, and public response contracts.
- Do not run `npm run deploy:production` automatically; commit/push and verify CI first.
- Do not log or persist source text, compressed text, cookies, JWTs, API keys, or raw provider/upstream bodies.
- The current production MCP endpoint is `https://semantic-compression-mcp.kinotch.workers.dev/mcp`; normal release smoke must reject another hostname.
- `npm ci` must run before build/test/dry-run release work so the lockfile defines the installed dependency tree.
- Existing verified controls remain unchanged: MCP rate limit, source revision gate, Text Worker invocation log disablement, and upstream count validation.

## Review Focus

- A valid-looking MCP endpoint for another Worker must fail before any cookie-bearing request.
- A release must reinstall dependencies from `package-lock.json` before bundling or tests.
- Requests without `CF-Connecting-IP` must not allow caller-controlled `X-Forwarded-For` rate-limit keys.
- A future MCP prompt version must be independently representable from the fixed profile name.
- Smoke errors must expose only safe status/content-type/provider code metadata, never response bodies or cookies.

### Task 1: Bind MCP release smoke to the deployed endpoint

**Files:**
- Modify: `scripts/mcp-release.mjs`
- Modify: `scripts/deploy-production.mjs`
- Test: `test/mcp-release.test.js`
- Test: `test/deploy-production.test.js`
- Modify: `docs/semantic-compression-mcp.md`

**Interfaces:**
- Produce `MCP_RELEASE_HOST` and `MCP_RELEASE_ENDPOINT` constants for the current Worker deployment.
- `resolveMcpSmokeInputs(env)` continues to consume operator cookie input but rejects a non-HTTPS, non-`/mcp`, or wrong-host endpoint before smoke.

- [x] Add a failing test for a valid HTTPS `/mcp` endpoint on the wrong hostname and a passing test for the current production hostname.
- [x] Add a failing release-source assertion that the validated endpoint, not an unvalidated raw environment value, is recorded in release metadata.
- [x] Implement the fixed host/endpoint validation and use the validated endpoint for MCP smoke and metadata.
- [x] Update the MCP operations document with the exact production endpoint and wrong-host failure behavior.
- [x] Run focused MCP release/deploy tests.

### Task 2: Rebuild the dependency tree at the production gate

**Files:**
- Modify: `scripts/deploy-production.mjs`
- Test: `test/deploy-production.test.js`

**Interfaces:**
- The production script runs `npm ci` after source/config assertions and before snapshot build, tests, dry-runs, or Worker deploys.

- [x] Add a failing source-contract test asserting the release gate invokes `npm ci` before `build:text-snapshot`.
- [x] Add `await run(npmCommand, ["ci"])` with an explicit release stage.
- [x] Run the focused deploy tests without deploying to Cloudflare.

### Task 3: Stop trusting X-Forwarded-For as a client identity fallback

**Files:**
- Modify: `src/middleware/rate-limit.js`
- Test: `test/compression-api.test.js`

**Interfaces:**
- `cf-connecting-ip` remains the preferred key.
- If it is absent, the rate-limit identity is the fixed value `unknown`; `x-forwarded-for` is ignored.

- [x] Add a failing Gateway test sending only `X-Forwarded-For` and assert the generated key ends in `unknown`.
- [x] Replace the fallback with the fixed non-user-controlled value.
- [x] Run the focused compression API tests.

### Task 4: Separate MCP expected prompt version metadata

**Files:**
- Modify: `src/semantic-compression-mcp/contract.js`
- Modify: `src/semantic-compression-mcp/upstream.js`
- Modify: `test/semantic-compression-mcp-contract.test.js`
- Modify: `test/semantic-compression-mcp-upstream.test.js`

**Interfaces:**
- `MCP_COMPRESSION_PROFILE` remains `semantic-dense-v1`.
- Produce `MCP_EXPECTED_PROMPT_VERSION` from the compression contract's prompt-version constant and use it for upstream validation/provenance fallback.

- [x] Add a failing contract assertion that profile and expected prompt version are separate named constants with current values.
- [x] Change upstream validation to compare `prompt_version` to `MCP_EXPECTED_PROMPT_VERSION`.
- [x] Run focused MCP contract/upstream tests.

### Task 5: Add safe MCP smoke diagnostics

**Files:**
- Modify: `scripts/smoke-mcp.mjs`
- Test: `test/smoke-mcp.test.js`
- Modify: `docs/semantic-compression-mcp.md`

**Interfaces:**
- Non-success HTTP responses may report status, normalized content type, and a bounded numeric/string error code extracted from a JSON error envelope or safe header.
- Response bodies, cookies, JWTs, and arbitrary error messages must never be included.

- [x] Add a failing test for a 401 JSON response containing a numeric error code and a secret message; assert status/content type/code are reported and the secret is absent.
- [x] Add a failing test for notification failure with status/content type diagnostics.
- [x] Implement one shared safe HTTP failure formatter for request and notification paths.
- [x] Document the 401/403/404/5xx diagnostic fields and cookie-selection troubleshooting.
- [x] Run focused smoke tests.

### Task 6: Refresh repository state documentation and assess Verify pinning

**Files:**
- Modify: `.github/workflows/verify.yml`
- Modify: `project/docs/CURRENT_STATE.md`
- Modify: `docs/OPERATIONS.md`
- Test: `test/production-deploy-authority-docs.test.js` or a new focused workflow/docs test

**Interfaces:**
- Verify is Base-managed; any checkout SHA pin must be applied through the KiNoTch Base update path rather than a local workflow edit.
- Documentation records that `test` remains required and `Verify` should also be required when GitHub branch protection is managed externally.

- [x] Add a failing assertion that Current State no longer says Base verification is unconfirmed.
- [x] Confirm that the Verify workflow is Base-managed and do not mutate it locally.
- [x] Update Current State and operations guidance; do not mutate GitHub branch protection from repository code.
- [x] Run the focused documentation/workflow tests.

### Final verification and delivery

- [ ] Run `npm test`.
- [ ] Run `git diff --check`.
- [ ] Run the three Worker dry-runs required by the repository.
- [ ] Confirm `src/text-core` and generated snapshot files are unchanged.
- [ ] Commit changes by coherent reason, push to `origin/main`, and verify GitHub `test` and `Verify` checks for the pushed SHA.
- [ ] Do not run Production deploy in this task.
