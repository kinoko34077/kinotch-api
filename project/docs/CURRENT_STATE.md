# Current State

Base version: `0.3.8`

Last verified: 2026-09-25 — existing Production release `058628f9b28648f897c53b8c38b27f55ca4e4587` and Codex Managed OAuth MCP E2E verified; Jev Audit Remote feature implementation/release hardening verified on branch, live Jev production verification pending; Codex Service Auth helper repository implementation verified, live Service Auth E2E pending

## Implemented

- Repository-local KiNoTch Base v0.3.8 and Project Overlay
- API and MCP Surface declarations
- Structured npm setup, test, dev, and deploy command entries
- Existing Hono/Worker, generated snapshot, MCP, and deployment boundaries retained
- Existing Domain files remain at their original paths; no bulk move was performed
- Detailed usage, operations, and first-parent development history are documented under docs/ and linked from this index
- Production smoke uses fixed Gateway, Text Worker, and Compression Worker targets; standalone diagnostic smoke keeps local endpoint overrides separate.
- Production release verifies `main == origin/main`, rebuilds dependencies with `npm ci`, and isolates release-only secrets from build/test child processes.
- Production operator secrets are supplied through the fixed external `%USERPROFILE%\.kinotch-secrets\kinotch-api.production.env` opaque boundary by `production-secret-mapper.mjs`; the Jev Audit feature extends the Production required-key set to the documented Jev Audit keys while unknown file keys remain ignored and unforwarded, and `smoke:mcp:local` / `release:local` remain launchers rather than alternate production authorities.
- MCP automated release/recovery smoke uses dedicated Cloudflare Access Service Token credentials and does not use a browser session cookie. Codex interactive use remains a separate Managed OAuth path and is recorded independently as operator evidence.
- The fixed external secret-file parser also recognizes optional Codex-only `CODEX_CF_ACCESS_CLIENT_ID` / `CODEX_CF_ACCESS_CLIENT_SECRET` values without adding them to either Production release or release-smoke required-key sets.
- `scripts/codex-mcp-access-headers.mjs` implements the Codex `http_headers_helper` boundary: it accepts no alternate path, requires only the Codex-specific pair, and emits only `CF-Access-Client-Id` / `CF-Access-Client-Secret` as the machine-consumed JSON header object. Missing credentials fail before connection without printing secret values.
- Production release `058628f9b28648f897c53b8c38b27f55ca4e4587` succeeded on 2026-09-25 and is recorded by `docs/releases/20260925T094316840Z.json`; Text, Compression, MCP, and Gateway deployments all report `needsRollback: false`, Gateway/Text/Compression smoke passed, and Compression MCP Service Token smoke passed.
- Codex CLI 0.155.1 separately verified the interactive Managed OAuth path against the Production Compression MCP endpoint: OAuth, tool discovery, `compress_text`, and returned `semantic-dense-v1` / `semantic-dense-v1.1` / `gemini-3.5-flash-lite` contract all passed without using the Service Token. This is operator E2E evidence separate from release metadata.
- Worker deploy results are reconciled against remote active versions; rollback verifies the active version and runs non-billable recovery smoke.
- Remote MCP rate limiting prefers a non-reversible fingerprint of the verified Access subject/email claim and falls back to `CF-Connecting-IP` only when no stable claim exists.
- Repository runtime is pinned to Node 26.10.0 through `package.json`, `package-lock.json`, `.node-version`, and the project-owned CI workflow.
- Gemini generation uses the stable Interactions API `v1/interactions`; fixed-prompt `countTokens` measurement remains on the documented `v1beta` token endpoint.
- Node 26.10.0 migration verification completed with `npm ci`, the full test suite, and dry-runs for Text, Compression, MCP, and Gateway Workers; the opt-in live Gemini test remains excluded from ordinary CI.
- Base main commit `60592ce7535502356b65e9ae76da2ded3c1dff06` pins the Base-managed checkout action. This repository still intentionally adopts the tracked Base v0.3.8 snapshot; a broad Base v0.4.0 synchronization was not performed.
- Jev Audit Remote is implemented on `feat/jev-audit-remote-api-mcp`: the private `jev-audit` Worker owns snapshot validation, batching, TypeSafe System One calls, response validation, and deterministic aggregation; REST `/v1/audit` and `jev-audit-mcp` use the shared private Worker boundary.
- Jev Audit Remote preserves `jev-audit` v0.2.12 semantics, exposes only explicit file snapshots with `development` / `generic` profiles, and adds production release/smoke/rollback integration without changing the local Python CLI/STDIO MCP implementation.
- Jev Audit release hardening captures the pre-release Gateway version. If the existing core release succeeds but Jev Audit post-core smoke fails, the public Gateway is rolled back and recovery-smoked before the Jev Audit MCP/private Workers are recovered. If the core release itself fails, the existing core rollback remains authoritative and the wrapper does not perform a second Gateway rollback.
- Release failure metadata preserves the original failure stage even while rollback/recovery updates the live release stage.

## Default state

- `api`: `OVERRIDE` — HTTP and Worker behavior is Project-owned
- `mcp`: `OVERRIDE` — existing MCP Worker behavior is Project-owned
- `ci-test`: `OVERRIDE` — existing CI workflow is authoritative
- `generated-integrity`: `OVERRIDE` — existing generated snapshot checks are authoritative

## Known constraints

- Public HTTP status and error-code contracts remain unchanged outside the new Jev Audit surface.
- Cloudflare bindings, provider retry, deploy, and rollback policy remain Project-owned.
- Runtime Action contracts are not required by this adoption.
- GitHub main protection currently requires `test` and `verify`; force push and branch deletion are disabled. PR review, administrator enforcement, strict status, Cloudflare Workers Builds state, and Cloudflare Access state remain external/operator-managed choices.
- Node 26 is the repository-selected runtime. `@rolldown/plugin-babel@0.2.4`, pulled transitively through the current Agents dependency set, still declares an upstream Node engine range that does not explicitly list Node 26; repository installation, tests, and all Worker dry-runs nevertheless pass on Node 26.10.0. Treat an upstream engine-range change as dependency metadata to re-check rather than as production proof by itself.
- Cloudflare Access Service Token creation and its `Service Auth` policies are external operator-managed state; repository tests verify only request/header contracts, not dashboard configuration itself.
- The generated release metadata intentionally keeps `mcpOAuthSmoke.status = operator_required`; it is immutable evidence of what that release process itself verified. The later Codex Managed OAuth E2E PASS is recorded separately in this Current State rather than rewriting the release record.
- Codex Service Auth helper code is repository-verified, but the Codex-dedicated Cloudflare Service Token, matching Access `Service Auth` policy, machine-local Codex `http_headers_helper` configuration, and real Service Auth `compress_text` E2E remain external operator evidence until performed.
- The Codex helper provides an operational secret-isolation boundary, not a hard OS privilege boundary against arbitrary same-user shell access.
- The latest tracked Production release predates the Jev Audit Remote feature. Jev Audit live E2E / production verification is pending; unit/integration tests and release wiring do not count as evidence that the live TypeSafe REST path, deployed private Worker, Cloudflare Access policy, or authenticated Jev Audit MCP tool call has succeeded.

## Next work

1. Keep GitHub Actions `test` and `Verify` successful while integrating the verified Jev Audit feature branch through the existing PR/branch-protection flow.
2. Confirm the operator-managed Cloudflare/TypeSafe production configuration required by the Jev Audit surface without moving secret values into the repository.
3. From synchronized clean `main`, run the formal Jev Audit-aware production release gate.
4. Confirm one live TypeSafe REST E2E and one authenticated Jev Audit MCP tool-call E2E, then record deployed version IDs and smoke evidence.
5. Create/select a Codex-dedicated Cloudflare Access Service Token, add the exact-token `Service Auth` policy, add the two `CODEX_CF_ACCESS_*` values to the fixed secret file, configure Codex `http_headers_helper`, and run one synthetic Compression MCP `compress_text` Service Auth E2E without an OAuth prompt.
6. Record the Codex Service Auth E2E as operator evidence and close Work Order #9 after its PR review/merge.
7. After production verification, use the features in normal operation and add only lightweight log accumulation / benchmark checks if they provide practical value.

## Verification

- Production release metadata `docs/releases/20260925T094316840Z.json`: `status = succeeded`, `gitRevision = sourceRevision = 058628f9b28648f897c53b8c38b27f55ca4e4587`
- Production Text, Compression, MCP, and Gateway deployments for that release: deployed with `needsRollback = false`
- Gateway/Text/Compression production smoke: passed
- Compression MCP release Service Token smoke: passed (`authMode = access_service_token`)
- Codex CLI 0.155.1 Managed OAuth E2E for Compression MCP: OAuth PASS, `tools/list` PASS, `compress_text` discovery/call PASS, Service Token not used
- Codex Service Auth helper unit/regression coverage: shared file recognizes Codex-only keys, Production modes do not forward them, helper JSON contains only the two Access headers, missing-pair and alternate-path cases fail safely
- Codex Service Auth documentation contract: `http_headers_helper`, fixed secret path, Codex-only key names, Service Auth headers, and Managed OAuth coexistence are documented without real credentials
- Real Codex Service Auth E2E: pending external Codex-dedicated Service Token / Access policy / local config setup
- `knt doctor`
- `knt base-check`
- `knt setup`
- `knt verify`
- `npm test`
- Node 26.10.0 Worker dry-runs are included in the project CI/release verification boundaries.
- GitHub Actions `CI` and `Verify` were successful on the Jev Audit implementation head before main synchronization; the merge-synchronization commit must pass the same required checks before integration.
- Service Token contract tests cover header injection, missing credential failure, legacy cookie rejection, mapper allowlist/mode boundaries, and secret non-disclosure.
- Jev Audit Remote automated coverage includes contract, evaluator, private Worker, REST, MCP, release, smoke, Gateway rollback recovery, failure-stage provenance, and documentation contracts; live provider/deployment evidence remains pending.
