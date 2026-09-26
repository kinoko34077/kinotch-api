# Current State

Base version: `0.3.8`

Last verified: 2026-09-26 — Production release source `84e8109ef43064efd72fd1012054dc7787de6a8e` completed successfully with Jev Audit live TypeSafe REST E2E and Cloudflare Access Service Token MCP `audit_files` E2E; release evidence was merged on `main` by `40eb67448deef5cd711b106dc27977236207af09`; Compression Managed OAuth E2E remains separately verified; Jev Audit uses Service Token as its accepted normal Production MCP authentication path and does not require Jev-specific Managed OAuth completion

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
- MCP automated release/recovery smoke uses Cloudflare Access Service Token credentials and does not use a browser session cookie. Compression interactive Codex Managed OAuth remains a separate operator path. Jev Audit accepts the Service Token path as its normal Production MCP authentication path; Jev-specific Managed OAuth is optional and not a completion requirement.
- The fixed external secret-file parser recognizes optional Codex-only `CODEX_CF_ACCESS_CLIENT_ID` / `CODEX_CF_ACCESS_CLIENT_SECRET` values without adding them to either Production release or release-smoke required-key sets.
- `scripts/codex-mcp-access-headers.mjs` implements the Codex `http_headers_helper` boundary. By default it reuses the existing release-smoke `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`; if both Codex-specific override keys exist they take precedence; if only one override key exists or either override value is empty the helper fails closed. It accepts no alternate path and emits only `CF-Access-Client-Id` / `CF-Access-Client-Secret` as the machine-consumed JSON header object without printing secret values.
- The selected default Codex Service Auth mode therefore requires no duplicate secret values and no additional Cloudflare Service Token or Access policy for the existing Compression MCP application. The existing release-smoke exact-token `Service Auth` policy is reused. A separate Codex token remains an optional future override if independent revocation becomes necessary.
- `scripts/configure-codex-mcp-service-auth.mjs` plus `npm run setup:codex-mcp-service-auth` provide a bounded machine-local Codex setup path. The setup edits only `%USERPROFILE%\.codex\config.toml`, preserves unrelated config sections, replaces or inserts only the `mcp_servers.semantic_compressor` scalar section, records the absolute local path to `scripts/codex-mcp-access-headers.mjs`, accepts no alternate config path, and fails closed on duplicate target sections. It never writes Service Token values into Codex config.
- Production release `058628f9b28648f897c53b8c38b27f55ca4e4587` succeeded on 2026-09-25 and is recorded by `docs/releases/20260925T094316840Z.json`; Text, Compression, MCP, and Gateway deployments all report `needsRollback: false`, Gateway/Text/Compression smoke passed, and Compression MCP Service Token smoke passed.
- Codex CLI 0.155.1 separately verified the interactive Managed OAuth path against the Production Compression MCP endpoint: OAuth, tool discovery, `compress_text`, and returned `semantic-dense-v1` / `semantic-dense-v1.1` / `gemini-3.5-flash-lite` contract all passed without using the Service Token. This is operator E2E evidence separate from release metadata.
- Worker deploy results are reconciled against remote active versions; rollback verifies the active version and runs non-billable recovery smoke.
- Remote MCP rate limiting prefers a non-reversible fingerprint of the verified Access subject/email claim and falls back to `CF-Connecting-IP` only when no stable claim exists.
- Repository runtime is pinned to Node 26.10.0 through `package.json`, `package-lock.json`, `.node-version`, and the project-owned CI workflow.
- Root npm dependency maintenance uses Dependabot weekly version updates for `/`, with an open version-update PR limit of `3`; compatible minor/patch updates are grouped while major updates remain separate.
- Pull requests that change the root `package.json` or `package-lock.json` run the repository-local `Dependency Review` workflow with `contents: read`, vulnerability checking at `low` severity or above, license checking disabled, and all newly introduced third-party Actions pinned to immutable commit SHAs. This workflow is not promoted to a protected required check, and CodeQL remains deferred.
- This dependency hardening changes GitHub maintenance/review behavior only; it is not Production release or Cloudflare deployment evidence.
- Gemini generation uses the stable Interactions API `v1/interactions`; fixed-prompt `countTokens` measurement remains on the documented `v1beta` token endpoint.
- Node 26.10.0 migration verification completed with `npm ci`, the full test suite, and dry-runs for Text, Compression, MCP, and Gateway Workers; the opt-in live Gemini test remains excluded from ordinary CI.
- Base main commit `60592ce7535502356b65e9ae76da2ded3c1dff06` pins the Base-managed checkout action. This repository still intentionally adopts the tracked Base v0.3.8 snapshot; a broad Base v0.4.0 synchronization was not performed.
- Jev Audit Remote is implemented and integrated into the main project implementation: the private `jev-audit` Worker owns snapshot validation, batching, TypeSafe System One calls, response validation, and deterministic aggregation; REST `/v1/audit` and `jev-audit-mcp` use the shared private Worker boundary.
- Jev Audit Remote preserves `jev-audit` v0.2.12 semantics, exposes only explicit file snapshots with `development` / `generic` profiles, and adds production release/smoke/rollback integration without changing the local Python CLI/STDIO MCP implementation.
- Jev Audit Access JWT verification, MCP body-limit ordering, actor-fingerprint/IP rate limiting, stateless Streamable HTTP MCP handler, and private Service Binding pattern are aligned with the current Semantic Compression Remote MCP implementation while using dedicated bindings/namespaces.
- Jev Audit release hardening captures the pre-release Gateway version. If the existing core release succeeds but Jev Audit post-core smoke fails, the public Gateway is rolled back and recovery-smoked before the Jev Audit MCP/private Workers are recovered. If the core release itself fails, the existing core rollback remains authoritative and the wrapper does not perform a second Gateway rollback.
- Release failure metadata preserves the original failure stage even while rollback/recovery updates the live release stage.
- Jev Audit Production release sourced from `84e8109ef43064efd72fd1012054dc7787de6a8e` completed on 2026-09-25 and is recorded by `docs/releases/20260925T144351192Z.json` and `docs/releases/jev-audit-20260925T144353075Z.json`. Jev REST returned HTTP 200 through live TypeSafe with model `jev-1.13.0` / semantics `0.2.12`; Jev MCP Service Token authentication returned HTTP 200 and completed a real `audit_files` call; private/MCP deployments reported `needsRollback: false`; no rollback was required.
- Post-release Jev hardening aligns MCP path validation with the REST Unicode code-point contract, rejects provider model drift from the pinned `jev-1.13.0`, makes the Service Token full smoke call and validate `list_profiles` before `audit_files`, and removes unused private Worker vars that falsely implied runtime timeout/log configurability. These repository changes require the next normal formal release before they are claimed as deployed Production behavior.

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
- Cloudflare Access Service Token creation and its `Service Auth` policies are external operator-managed state; repository tests verify request/header contracts, not dashboard configuration itself. Jev Audit Production evidence proves the configured Service Token path worked at release time, but repository tests do not independently query the dashboard policy state.
- The generated Compression release metadata intentionally keeps `mcpOAuthSmoke.status = operator_required`; it is immutable evidence of what that release process itself verified. The later Compression Codex Managed OAuth E2E PASS is recorded separately in this Current State rather than rewriting the release record. This does not impose a Managed OAuth requirement on Jev Audit.
- Codex Service Auth defaults to sharing the release-smoke Service Token. This intentionally couples credential rotation, revocation, and compromise scope between automated release smoke and local Codex Service Auth. The optional complete `CODEX_CF_ACCESS_*` override restores independent revocation when needed.
- Codex Service Auth helper and machine-local setup code are repository-verified, but execution of `npm run setup:codex-mcp-service-auth`, inspection of the resulting live Codex registration, and a real Service Auth `compress_text` E2E remain external machine evidence until performed.
- The Codex helper provides an operational secret-isolation boundary, not a hard OS privilege boundary against arbitrary same-user shell access.
- The latest Jev Audit tracked Production evidence is successful, but post-release repository hardening is not Production evidence until a later authorized formal release carries those changes. No ad-hoc deploy is required solely to close the rollout Issue.
- Service Token Access JWTs may not provide a stable subject/email claim; Jev MCP rate limiting then falls back to `CF-Connecting-IP`. This is acceptable for the current low-volume single-operator automation path but can group callers sharing one egress IP into the same 5 requests / 60 seconds bucket.

## Next work

1. Keep GitHub Actions `test` and `Verify` successful while using the verified Jev REST / Service Token MCP surfaces in normal operation.
2. Do not require Jev-specific Managed OAuth. If a future interactive-human Jev MCP flow needs OAuth, treat it as a separate optional feature rather than a production-readiness blocker.
3. Carry the post-release Jev hardening into Production only through the next authorized normal `npm run release:local`; do not perform an ad-hoc deploy solely for the hardening.
4. On the authorized Codex machine, if Compression Service Auth use is still desired, synchronize `main` and run `npm run setup:codex-mcp-service-auth`. This configures machine-local `semantic_compressor` with an absolute `http_headers_helper` path and reuses the existing release Service Token without adding `CODEX_CF_ACCESS_*` values or a new Cloudflare policy. Confirm `codex mcp list`, then run one synthetic Compression MCP `compress_text` Service Auth E2E without an OAuth prompt.
5. Add only lightweight log accumulation / 5–10 fixed-fixture benchmark checks if they provide practical value; do not build a large eval platform, dashboard, billing, account system, remote Git clone, or filesystem layer without a concrete requirement.

## Verification

- Production release metadata `docs/releases/20260925T094316840Z.json`: `status = succeeded`, `gitRevision = sourceRevision = 058628f9b28648f897c53b8c38b27f55ca4e4587`
- Production Text, Compression, MCP, and Gateway deployments for that release: deployed with `needsRollback = false`
- Gateway/Text/Compression production smoke: passed
- Compression MCP release Service Token smoke: passed (`authMode = access_service_token`)
- Codex CLI 0.155.1 Managed OAuth E2E for Compression MCP: OAuth PASS, `tools/list` PASS, `compress_text` discovery/call PASS, Service Token not used
- Codex Service Auth helper unit/regression coverage: default release-token fallback, complete Codex-specific override precedence, partial override fail-closed behavior, Production-mode isolation, exact two-header JSON output, and alternate-path rejection
- Codex Service Auth setup unit/regression coverage: fixed machine-local config path, absolute helper command, bounded target-section replacement, unrelated-section preservation, duplicate-target rejection, alternate-path rejection, and no Service Token literals in config
- Codex Service Auth documentation contract: `http_headers_helper`, fixed secret path, default release-token reuse, optional Codex override, one-command machine-local setup, Service Auth headers, and Managed OAuth coexistence are documented without real credentials
- Real Codex Service Auth E2E for Compression remains optional/pending machine evidence; no additional Cloudflare token/policy is required for the selected reuse mode
- Jev Audit one-time bootstrap TDD: missing bootstrap module and confirmation-propagation regressions were observed RED before implementation; current contract covers explicit confirmation, private→MCP safe resume, completed-bootstrap rejection, dedicated Wrangler configs, opaque Cloudflare-only secret mapping, and package launchers.
- Jev Audit successful Production release evidence: `docs/releases/20260925T144351192Z.json` and `docs/releases/jev-audit-20260925T144353075Z.json`
- Jev Audit live TypeSafe REST E2E: PASS, HTTP 200, model `jev-1.13.0`, semantics `0.2.12`, 2 files / 1 batch
- Jev Audit MCP Service Token E2E: PASS, HTTP 200, authenticated `audit_files` tool call; Service Token is the accepted Jev MCP Production path
- Jev Audit deployed versions recorded at successful release: private `aedb81fd-58ef-4296-93bb-a538511bdbcb`, MCP `cd45c6cc-aaf1-453a-831c-d4ff83a16339`, both `needsRollback: false`
- Jev Audit successful release required no rollback; core Text / Compression / MCP / Gateway deploy and smoke also passed
- Post-release Jev hardening TDD/regression coverage: pinned-model mismatch rejection, REST/MCP Unicode path-count alignment, Service Token `list_profiles` + `audit_files` full smoke, and unused Wrangler-var rejection
- `knt doctor`
- `knt base-check`
- `knt setup`
- `knt verify`
- `npm test`
- Node 26.10.0 Worker dry-runs are included in the project CI/release verification boundaries.
- Service Token contract tests cover header injection, missing credential failure, legacy cookie rejection, mapper allowlist/mode boundaries, and secret non-disclosure.
- Jev Audit Remote automated coverage includes contract, evaluator, private Worker, REST, MCP, release, smoke, Gateway rollback recovery, failure-stage provenance, bootstrap boundaries, documentation contracts, and post-release hardening checks.
