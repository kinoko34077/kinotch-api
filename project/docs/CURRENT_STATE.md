# Current State

Base version: `0.3.8`

Last verified: 2026-09-25 — Production release `058628f9b28648f897c53b8c38b27f55ca4e4587` and Codex Managed OAuth MCP E2E

## Implemented

- Repository-local KiNoTch Base v0.3.8 and Project Overlay
- API and MCP Surface declarations
- Structured npm setup, test, dev, and deploy command entries
- Existing Hono/Worker, generated snapshot, MCP, and deployment boundaries retained
- Existing Domain files remain at their original paths; no bulk move was performed
- Detailed usage, operations, and first-parent development history are documented under docs/ and linked from this index
- Production smoke uses fixed Gateway, Text Worker, and Compression Worker targets; standalone diagnostic smoke keeps local endpoint overrides separate.
- Production release verifies `main == origin/main`, rebuilds dependencies with `npm ci`, and isolates release-only secrets from build/test child processes.
- Production operator secrets can be supplied through the fixed external `%USERPROFILE%\\.kinotch-secrets\\kinotch-api.production.env` opaque boundary by `production-secret-mapper.mjs`; Production release consumes seven supported keys including `CLOUDFLARE_API_TOKEN`, ignores unknown file keys without forwarding them, `smoke:mcp:local` and `release:local` remain launchers only, and the formal authority remains `npm run deploy:production`.
- MCP automated release/recovery smoke uses a dedicated Cloudflare Access Service Token (`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`) and does not use a browser session cookie.
- Production release `058628f9b28648f897c53b8c38b27f55ca4e4587` succeeded on 2026-09-25 and is recorded by `docs/releases/20260925T094316840Z.json`; Text, Compression, MCP, and Gateway deployments all report `needsRollback: false`, Gateway/Text/Compression smoke passed, and MCP Service Token smoke passed.
- Codex CLI 0.155.1 separately verified the interactive Managed OAuth path against the Production MCP endpoint: OAuth, tool discovery, `compress_text`, and returned `semantic-dense-v1` / `semantic-dense-v1.1` / `gemini-3.5-flash-lite` contract all passed without using the Service Token. This is operator E2E evidence separate from release metadata.
- Worker deploy results are reconciled against remote active versions; rollback verifies the active version and runs non-billable recovery smoke.
- Remote MCP rate limiting prefers a non-reversible fingerprint of the verified Access subject/email claim and falls back to `CF-Connecting-IP` only when no stable claim exists.
- Repository runtime is pinned to Node 26.10.0 through `package.json`, `package-lock.json`, `.node-version`, and the project-owned CI workflow.
- Gemini generation uses the stable Interactions API `v1/interactions`; fixed-prompt `countTokens` measurement remains on the documented `v1beta` token endpoint.
- Node 26.10.0 migration verification completed with `npm ci`, the full test suite, and dry-runs for Text, Compression, MCP, and Gateway Workers; the opt-in live Gemini test remains excluded from ordinary CI.
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
- Cloudflare Access Service Token creation and `Service Auth` policies are external operator-managed state; repository tests verify only request/header contracts, not dashboard configuration itself.
- The generated release metadata intentionally keeps `mcpOAuthSmoke.status = operator_required`; it is immutable evidence of what the release process itself verified. The later Codex Managed OAuth E2E PASS is recorded separately in this Current State rather than rewriting the release record.

## Next work

1. Merge the tracked 2026-09-25 Production release evidence through the normal PR / required-check workflow.
2. Track Codex Service Token access as a separate Work Order: use Codex's supported HTTP-header helper mechanism to obtain Cloudflare Access Service Token headers from an opaque local secret boundary without committing or printing credentials, while keeping release-smoke credentials and Codex credentials independently revocable.
3. Keep GitHub Actions `test` and `Verify` successful; both remain required checks on `main`.
4. Keep API and generated snapshot policy Project-owned.

## Verification

- Production release metadata `docs/releases/20260925T094316840Z.json`: `status = succeeded`, `gitRevision = sourceRevision = 058628f9b28648f897c53b8c38b27f55ca4e4587`
- Production Text, Compression, MCP, and Gateway deployments: deployed with `needsRollback = false`
- Gateway/Text/Compression production smoke: passed
- MCP release Service Token smoke: passed (`authMode = access_service_token`)
- Codex CLI 0.155.1 Managed OAuth E2E: OAuth PASS, `tools/list` PASS, `compress_text` discovery/call PASS, Service Token not used
- `knt doctor`
- `knt base-check`
- `knt setup`
- `knt verify`
- `npm test`
- GitHub Actions `test`: success
- GitHub Actions `Verify`: success
- Service Token contract tests cover header injection, missing credential failure, legacy cookie rejection, mapper allowlist/mode boundaries, and secret non-disclosure
