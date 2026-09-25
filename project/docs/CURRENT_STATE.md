# Current State

Base version: `0.3.8`

Last verified: 2026-09-25 — Jev Audit Remote feature implementation and release hardening verified on branch; live production verification pending

## Implemented

- Repository-local KiNoTch Base v0.3.8 and Project Overlay
- API and MCP Surface declarations
- Structured npm setup, test, dev, and deploy command entries
- Existing Hono/Worker, generated snapshot, MCP, and deployment boundaries retained
- Existing Domain files remain at their original paths; no bulk move was performed
- Detailed usage, operations, and first-parent development history are documented under docs/ and linked from this index
- Production smoke uses fixed Gateway, Text Worker, and Compression Worker targets; standalone diagnostic smoke keeps local endpoint overrides separate.
- Production release verifies `main == origin/main`, rebuilds dependencies with `npm ci`, and isolates release-only secrets from build/test child processes.
- Production operator secrets can be supplied through the fixed external opaque boundary by `production-secret-mapper.mjs`; local smoke/release launchers do not replace the formal `npm run deploy:production` authority.
- MCP automated release/recovery smoke uses a dedicated Cloudflare Access Service Token and does not use a browser session cookie. Codex interactive use remains a separate Managed OAuth path and is recorded independently as operator evidence.
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
- Cloudflare Access Service Token creation and its `Service Auth` policy are external operator-managed state; repository tests verify only the header/input contract, not the dashboard configuration itself.
- The latest tracked production release metadata still predates the Jev Audit Remote feature. Repository changes after that release are not production-confirmed until an operator runs the formal release gate.
- Jev Audit live E2E / production verification is pending. Unit/integration tests and release wiring do not count as evidence that the live TypeSafe REST path, deployed private Worker, Cloudflare Access policy, or authenticated MCP tool call has succeeded.

## Next work

1. Integrate the verified feature branch into `main` through the existing PR/branch-protection flow.
2. Confirm the operator-managed Cloudflare/TypeSafe production configuration required by the Jev Audit surface without moving secret values into the repository.
3. From synchronized clean `main`, run the formal production release gate.
4. Confirm one live TypeSafe REST E2E and one authenticated Jev Audit MCP tool-call E2E, then record deployed version IDs and smoke evidence.
5. After production verification, use the feature in normal operation and add only lightweight log accumulation / benchmark checks if they provide practical value.

## Verification

- `knt doctor`
- `knt base-check`
- `knt setup`
- `knt verify`
- `npm test`
- Node 26.10.0 Worker dry-runs are included in the project CI/release verification boundaries.
- GitHub Actions `CI`: success on feature head `68dcf67c8b3477eae02f1b8df38f5f3cbddaaba1` before this Current State synchronization commit.
- GitHub Actions `Verify`: success on feature head `68dcf67c8b3477eae02f1b8df38f5f3cbddaaba1` before this Current State synchronization commit.
- Service Token contract tests cover header injection, missing credential failure, legacy cookie rejection, mapper allowlist/mode boundaries, and secret non-disclosure.
- Jev Audit Remote automated coverage includes contract, evaluator, private Worker, REST, MCP, release, smoke, Gateway rollback recovery, failure-stage provenance, and documentation contracts; live provider/deployment evidence remains pending.
