# Current State

Base version: `0.3.8`

Last verified: 2026-09-25 — existing Production release `058628f9b28648f897c53b8c38b27f55ca4e4587` and Codex Managed OAuth MCP E2E verified; Jev Audit Remote implementation/release hardening and one-time bootstrap repository path verified, live Jev production verification pending; Codex Service Auth helper repository implementation supports release-token reuse, live Service Auth E2E pending

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
- Jev Audit first deployment has a separate one-time bootstrap path matching the Semantic Compression MCP responsibility split. `bootstrap:jev-audit:local` maps only `CLOUDFLARE_API_TOKEN` from the fixed opaque secret file plus the explicit non-secret `JEV_AUDIT_BOOTSTRAP_CONFIRM=true` signal, then creates only the private `jev-audit` and public `jev-audit-mcp` Workers in fail-closed state. It does not deploy the Gateway/core release, run live TypeSafe traffic, or perform authenticated MCP smoke. A private-only partial bootstrap can safely resume the MCP creation step; a completed two-Worker bootstrap refuses normal re-execution.
- MCP automated release/recovery smoke uses Cloudflare Access Service Token credentials and does not use a browser session cookie. Codex interactive use remains a separate Managed OAuth path and is recorded independently as operator evidence.
- The fixed external secret-file parser recognizes optional Codex-only `CODEX_CF_ACCESS_CLIENT_ID` / `CODEX_CF_ACCESS_CLIENT_SECRET` values without adding them to either Production release or release-smoke required-key sets.
- `scripts/codex-mcp-access-headers.mjs` implements the Codex `http_headers_helper` boundary. By default it reuses the existing release-smoke `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`; if both Codex-specific override keys exist they take precedence; if only one override key exists or either override value is empty the helper fails closed. It accepts no alternate path and emits only `CF-Access-Client-Id` / `CF-Access-Client-Secret` as the machine-consumed JSON header object without printing secret values.
- The selected default Codex Service Auth mode therefore requires no duplicate secret values and no additional Cloudflare Service Token or Access policy for the existing Compression MCP application. The existing release-smoke exact-token `Service Auth` policy is reused. A separate Codex token remains an optional future override if independent revocation becomes necessary.
- Production release `058628f9b28648f897c53b8c38b27f55ca4e4587` succeeded on 2026-09-25 and is recorded by `docs/releases/20260925T094316840Z.json`; Text, Compression, MCP, and Gateway deployments all report `needsRollback: false`, Gateway/Text/Compression smoke passed, and Compression MCP Service Token smoke passed.
- Codex CLI 0.155.1 separately verified the interactive Managed OAuth path against the Production Compression MCP endpoint: OAuth, tool discovery, `compress_text`, and returned `semantic-dense-v1` / `semantic-dense-v1.1` / `gemini-3.5-flash-lite` contract all passed without using the Service Token. This is operator E2E evidence separate from release metadata.
- Worker deploy results are reconciled against remote active versions; rollback verifies the active version and runs non-billable recovery smoke.
- Remote MCP rate limiting prefers a non-reversible fingerprint of the verified Access subject/email claim and falls back to `CF-Connecting-IP` only when no stable claim exists.
- Repository runtime is pinned to Node 26.10.0 through `package.json`, `package-lock.json`, `.node-version`, and the project-owned CI workflow.
- Gemini generation uses the stable Interactions API `v1/interactions`; fixed-prompt `countTokens` measurement remains on the documented `v1beta` token endpoint.
- Node 26.10.0 migration verification completed with `npm ci`, the full test suite, and dry-runs for Text, Compression, MCP, and Gateway Workers; the opt-in live Gemini test remains excluded from ordinary CI.
- Base main commit `60592ce7535502356b65e9ae76da2ded3c1dff06` pins the Base-managed checkout action. This repository still intentionally adopts the tracked Base v0.3.8 snapshot; a broad Base v0.4.0 synchronization was not performed.
- Jev Audit Remote is implemented and integrated into the main project implementation: the private `jev-audit` Worker owns snapshot validation, batching, TypeSafe System One calls, response validation, and deterministic aggregation; REST `/v1/audit` and `jev-audit-mcp` use the shared private Worker boundary.
- Jev Audit Remote preserves `jev-audit` v0.2.12 semantics, exposes only explicit file snapshots with `development` / `generic` profiles, and adds production release/smoke/rollback integration without changing the local Python CLI/STDIO MCP implementation.
- Jev Audit Access JWT verification, MCP body-limit ordering, actor-fingerprint/IP rate limiting, stateless Streamable HTTP MCP handler, and private Service Binding pattern are aligned with the current Semantic Compression Remote MCP implementation while using dedicated bindings/namespaces.
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
- Cloudflare Access Service Token creation and its `Service Auth` policies are external operator-managed state; repository tests verify request/header contracts, not dashboard configuration itself.
- The generated release metadata intentionally keeps `mcpOAuthSmoke.status = operator_required`; it is immutable evidence of what that release process itself verified. The later Codex Managed OAuth E2E PASS is recorded separately in this Current State rather than rewriting the release record.
- Codex Service Auth defaults to sharing the release-smoke Service Token. This intentionally couples credential rotation, revocation, and compromise scope between automated release smoke and local Codex Service Auth. The optional complete `CODEX_CF_ACCESS_*` override restores independent revocation when needed.
- Codex Service Auth helper code is repository-verified, but the machine-local Codex `http_headers_helper` configuration and real Service Auth `compress_text` E2E remain external operator evidence until performed.
- The Codex helper provides an operational secret-isolation boundary, not a hard OS privilege boundary against arbitrary same-user shell access.
- The latest tracked Production release predates the Jev Audit Remote feature. Jev Audit one-time bootstrap, Cloudflare Worker Secret registration, Access application/policy setup, live TypeSafe REST E2E, and authenticated Jev Audit MCP E2E remain external production evidence until performed; repository tests/dry-runs do not count as that evidence.

## Next work

1. Keep GitHub Actions `test` and `Verify` successful while completing the Jev Audit production rollout.
2. From clean synchronized `main`, run the one-time Jev Audit bootstrap through `JEV_AUDIT_BOOTSTRAP_CONFIRM=true` + `npm run bootstrap:jev-audit:local` if the two Jev Workers do not yet exist.
3. Register `TYPESAFE_API_KEY` only on the private `jev-audit` Worker and `JEV_AUDIT_API_TOKEN` only on the existing Gateway; use the same REST token value only as the opaque local `JEV_AUDIT_SMOKE_TOKEN` release input.
4. Create the `jev-audit-mcp.kinotch.workers.dev` Cloudflare Access application, enable the intended Managed OAuth policy, allow the existing release Service Token through an exact-token `Service Auth` policy, and record its Audience as `JEV_AUDIT_MCP_POLICY_AUD` in the opaque local inputs.
5. From synchronized clean `main`, run the formal Jev Audit-aware production release gate with `npm run release:local`.
6. Confirm one live TypeSafe REST E2E and authenticated Jev Audit MCP `list_profiles` / `audit_files` E2E, then record deployed version IDs and smoke evidence.
7. Configure machine-local Codex `semantic_compressor` with `http_headers_helper` pointing directly to `scripts/codex-mcp-access-headers.mjs`; in the selected default mode it will reuse the existing release Service Token without adding `CODEX_CF_ACCESS_*` values or a new Cloudflare policy. Run one synthetic Compression MCP `compress_text` Service Auth E2E without an OAuth prompt.
8. Record external E2E evidence separately, then use the features in normal operation and add only lightweight log accumulation / benchmark checks if they provide practical value.

## Verification

- Production release metadata `docs/releases/20260925T094316840Z.json`: `status = succeeded`, `gitRevision = sourceRevision = 058628f9b28648f897c53b8c38b27f55ca4e4587`
- Production Text, Compression, MCP, and Gateway deployments for that release: deployed with `needsRollback = false`
- Gateway/Text/Compression production smoke: passed
- Compression MCP release Service Token smoke: passed (`authMode = access_service_token`)
- Codex CLI 0.155.1 Managed OAuth E2E for Compression MCP: OAuth PASS, `tools/list` PASS, `compress_text` discovery/call PASS, Service Token not used
- Codex Service Auth helper unit/regression coverage: default release-token fallback, complete Codex-specific override precedence, partial override fail-closed behavior, Production-mode isolation, exact two-header JSON output, and alternate-path rejection
- Codex Service Auth documentation contract: `http_headers_helper`, fixed secret path, default release-token reuse, optional Codex override, Service Auth headers, and Managed OAuth coexistence are documented without real credentials
- Real Codex Service Auth E2E: pending machine-local Codex helper configuration and one synthetic `compress_text` call; no additional Cloudflare token/policy is required for the selected reuse mode
- Jev Audit one-time bootstrap TDD: missing bootstrap module and confirmation-propagation regressions were observed RED before implementation; current contract covers explicit confirmation, private→MCP safe resume, completed-bootstrap rejection, dedicated Wrangler configs, opaque Cloudflare-only secret mapping, and package launchers.
- Jev Audit bootstrap implementation head: GitHub Actions `CI` PASS and `Verify` PASS; CI includes `npm test`, Base compatibility, private Worker dry-run, Remote MCP Worker dry-run, and Gateway dry-run.
- `knt doctor`
- `knt base-check`
- `knt setup`
- `knt verify`
- `npm test`
- Node 26.10.0 Worker dry-runs are included in the project CI/release verification boundaries.
- Service Token contract tests cover header injection, missing credential failure, legacy cookie rejection, mapper allowlist/mode boundaries, and secret non-disclosure.
- Jev Audit Remote automated coverage includes contract, evaluator, private Worker, REST, MCP, release, smoke, Gateway rollback recovery, failure-stage provenance, bootstrap boundaries, and documentation contracts; live provider/deployment evidence remains pending.
