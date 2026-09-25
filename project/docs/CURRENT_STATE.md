# Current State

Base version: `0.3.8`

Last verified: 2026-09-25 — Node 26 runtime migration verification

## Implemented

- Repository-local KiNoTch Base v0.3.8 and Project Overlay
- API and MCP Surface declarations
- Structured npm setup, test, dev, and deploy command entries
- Existing Hono/Worker, generated snapshot, MCP, and deployment boundaries retained
- Existing Domain files remain at their original paths; no bulk move was performed
- Detailed usage, operations, and first-parent development history are documented under docs/ and linked from this index
- Production smoke uses fixed Gateway, Text Worker, and Compression Worker targets; standalone diagnostic smoke keeps local endpoint overrides separate.
- Production release verifies `main == origin/main`, rebuilds dependencies with `npm ci`, and isolates release-only secrets from build/test child processes.
- Production operator secrets can be supplied through the fixed external `%USERPROFILE%\\.kinotch-secrets\\kinotch-api.production.env` opaque boundary by `production-secret-mapper.mjs`; `smoke:mcp:local` and `release:local` are launchers only, and the formal authority remains `npm run deploy:production`.
- Worker deploy results are reconciled against remote active versions; rollback verifies the active version and runs non-billable recovery smoke.
- Remote MCP rate limiting prefers a non-reversible fingerprint of the verified Access subject/email claim and falls back to `CF-Connecting-IP` only when no stable claim exists.
- Repository runtime is pinned to Node 26.10.0 through `package.json`, `package-lock.json`, `.node-version`, and the project-owned CI workflow.
- Gemini generation uses the stable Interactions API `v1/interactions`; fixed-prompt `countTokens` measurement remains on the documented `v1beta` token endpoint.
- Node 26.10.0 migration verification completed with `npm ci`, the full 238-test suite, and dry-runs for Text, Compression, MCP, and Gateway Workers; 237 tests passed, 0 failed, and the opt-in live Gemini test remained skipped.
- Base main commit `60592ce7535502356b65e9ae76da2ded3c1dff06` pins the Base-managed checkout action. This repository still intentionally adopts the tracked Base v0.3.8 snapshot; a broad Base v0.4.0 synchronization was not performed.

## Default state

- `api`: `OVERRIDE` — HTTP and Worker behavior is Project-owned
- `mcp`: `OVERRIDE` — existing MCP Worker behavior is Project-owned
- `ci-test`: `OVERRIDE` — existing CI workflow is authoritative
- `generated-integrity`: `OVERRIDE` — existing generated snapshot checks are authoritative

## Known constraints

- Public HTTP status and error-code contracts remain unchanged.
- Cloudflare bindings, provider retry, deploy, and rollback policy remain Project-owned.
- Runtime Action contracts are not required by this adoption.
- GitHub main protection currently requires `test` and `verify`; force push and branch deletion are disabled. PR review, administrator enforcement, strict status, Cloudflare Workers Builds state, and Cloudflare Access state remain external/operator-managed choices.
- Node 26 is the repository-selected runtime. `@rolldown/plugin-babel@0.2.4`, pulled transitively through the current Agents dependency set, still declares an upstream Node engine range that does not explicitly list Node 26; repository installation, tests, and all Worker dry-runs nevertheless pass on Node 26.10.0. Treat an upstream engine-range change as dependency metadata to re-check rather than as production proof by itself.
- The latest tracked production release metadata still records source revision `204d15eb382802aa776d5026421e197d52725300`; repository changes after that release are not production-confirmed until an operator runs the formal release gate.

## Next work

1. Keep GitHub Actions `test` and `Verify` successful; both are currently required checks on `main`.
2. If the current main is approved for release, run `npm run deploy:production` from clean `origin/main` only after operator confirmation, then commit the generated release metadata through the normal workflow. This is intentionally not performed by repository maintenance.
3. Keep API and generated snapshot policy Project-owned.
4. Consider further Default adoption only where it removes a real duplicate.

## Verification

- `knt doctor`
- `knt base-check`
- `knt setup`
- `knt verify`
- `npm test`
- Node 26.10.0 migration result: 238 test cases, 237 passed, 0 failed, 1 skipped (opt-in live Gemini test)
- Node 26.10.0 Worker dry-runs: Text, Compression, MCP, and Gateway all succeeded
- GitHub Actions `test`: success
- GitHub Actions `Verify`: success
- Documentation links and source-of-truth references reviewed with the current repository layout
