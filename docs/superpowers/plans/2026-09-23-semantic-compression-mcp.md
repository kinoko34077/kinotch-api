# Semantic Compression Remote MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stateless, Cloudflare Access-protected Remote MCP adapter that exposes only `compress_text` and delegates compression to the existing private semantic-compression Worker.

**Architecture:** Add a separate `semantic-compression-mcp` Worker using Cloudflare Agents SDK v2 `createMcpHandler` and `@modelcontextprotocol/server` v2. The adapter validates Access JWTs, validates one fixed tool input, calls the existing compression Worker through Service Binding `COMPRESSION` without forwarding caller credentials, and returns a minimal MCP result. The existing REST Gateway, compression Worker, prompts, model, and provider contract remain unchanged.

**Tech Stack:** Cloudflare Workers, `agents/mcp/server`, `@modelcontextprotocol/server` v2, Zod v4, jose v6, Hono-independent Worker entry point, Node `node:test`, Wrangler.

**Spec:** User-provided Semantic Compression API Remote MCP implementation specification; repository outputs are `docs/specs/semantic-compression-mcp.md` and `docs/semantic-compression-mcp.md`.

## Global Constraints

- `/v1/compress` public contract and existing REST behavior must not change.
- `semantic-compression` remains private and remains the only Gemini/prompt/profile processing authority.
- MCP exposes exactly one tool, `compress_text`, with input `{ text: string }` and fixed internal profile `semantic-dense-v1`.
- MCP must use stateless Streamable HTTP at `/mcp` through `createMcpHandler`; no `McpAgent`, Durable Object, SSE primary transport, session state, or retry.
- MCP calls the compression Worker through Service Binding `COMPRESSION`; it never calls the public Gateway and never forwards `Authorization` or `COMPRESSION_API_TOKEN`.
- Access authentication fails closed using `Cf-Access-Jwt-Assertion`, `TEAM_DOMAIN`, `POLICY_AUD`, jose JWKS, issuer, audience, signature, and expiration checks.
- MCP Worker has no Gemini key, prompt, model, provider, or arbitrary generation configuration.
- Input limits reuse `MAX_GEMINI_INPUT_CODE_POINTS` and Unicode code-point counting from the existing compression contract.
- Production authority remains `npm run deploy:production`; Access/OAuth setup and authenticated Codex/Inspector smoke cannot be faked by repository code.
- Logs and results must not contain input text, compressed text except the intended tool result, JWT, Authorization, API keys, raw upstream/provider bodies, or system prompt.

## Review Focus

- A request with a missing or malformed Access JWT must fail before MCP dispatch and must not call the Service Binding.
- A valid MCP tool call containing `profile`, `prompt`, or `model` must be rejected by the strict input schema and never influence the downstream body.
- A Service Binding response with non-200 status, invalid JSON, wrong profile, empty text, invalid counts, or a raw secret must become a safe MCP error without leaking the body.
- A timed-out Service Binding call must become `compression_timeout` without retrying the generation request.
- A valid MCP request must send only `text` and fixed `semantic-dense-v1` to the binding, with no downstream Authorization header.

### Task 1: Public MCP contract, dependencies, and shared interfaces

**Files:**
- Create: `docs/specs/semantic-compression-mcp.md`
- Create: `docs/semantic-compression-mcp.md`
- Create: `wrangler.semantic-compression-mcp.jsonc`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/semantic-compression-mcp-contract.test.js`

**Interfaces:**
- Consumes: existing `src/semantic-compression/contract.js` exports `COMPRESSION_PROFILE_SEMANTIC_DENSE`, `MAX_GEMINI_INPUT_CODE_POINTS`, and `countUnicodeCodePoints`.
- Produces: MCP package imports, Worker configuration with Service Binding `COMPRESSION`, and documented `compress_text` contract for later tasks.

- [ ] **Step 1: Write the MCP contract test first**

  Add tests that import the not-yet-created MCP contract helpers and assert the fixed tool name/profile, strict `{text}` input behavior, code-point limit reuse, and safe result field allowlist.

- [ ] **Step 2: Run the focused contract test and verify the expected missing-module failure**

  Run: `node --test test/semantic-compression-mcp-contract.test.js`

  Expected: FAIL because the new MCP contract module does not exist yet.

- [ ] **Step 3: Add current compatible MCP dependencies**

  Install the official compatible set `agents@0.24.0`, `@modelcontextprotocol/server@2.0.0`, `zod@4.6.5`, and `jose@6.2.12`. Keep `wrangler` at the existing version and do not add `@modelcontextprotocol/sdk` unless the installed Agents peer graph requires it.

- [ ] **Step 4: Add the MCP Worker configuration and public contract documentation**

  Configure `semantic-compression-mcp` with `workers_dev: true`, `preview_urls: false`, `observability.logs.invocation_logs: false`, and Service Binding `COMPRESSION` to `semantic-compression`. Do not invent `TEAM_DOMAIN` or `POLICY_AUD` values; document them as operator-provided vars and make missing values fail closed. Document endpoint, tool, Access setup, privacy, testing, Codex registration, deploy, rollback, and external blockers.

- [ ] **Step 5: Implement only the minimal contract helpers needed by the test**

  Create `src/semantic-compression-mcp/contract.js` with fixed tool/profile constants, strict text validation using shared code-point helpers, and safe provenance normalization. Do not duplicate prompts, model selection, or compression logic.

- [ ] **Step 6: Run the focused test and the existing suite**

  Run: `node --test test/semantic-compression-mcp-contract.test.js` and `npm test`

  Expected: MCP contract tests pass and all pre-existing tests remain green.

- [ ] **Step 7: Commit the contract and dependency boundary**

  Commit: `feat: add semantic compression mcp contract`

### Task 2: Access JWT verification and upstream adapter

**Files:**
- Create: `src/semantic-compression-mcp/access-auth.js`
- Create: `src/semantic-compression-mcp/upstream.js`
- Modify: `test/semantic-compression-mcp-contract.test.js`
- Create: `test/semantic-compression-mcp-auth.test.js`
- Create: `test/semantic-compression-mcp-upstream.test.js`

**Interfaces:**
- Consumes: Task 1 contract helpers and Worker env `TEAM_DOMAIN`, `POLICY_AUD`, `COMPRESSION`.
- Produces: `verifyAccessJwt(request, env, options)`, `callCompressionService(env, text, options)`, and safe error objects consumed by the Worker/tool layer.

- [ ] **Step 1: Write failing JWT tests**

  Cover missing header, missing configuration, malformed token, bad issuer, bad audience, expired token, invalid signature, and valid fixture-key token. Assert that failures are classified as `authentication_failed`/`authentication_unavailable` and contain no token or claims.

- [ ] **Step 2: Run JWT tests and verify they fail because auth helpers are absent**

  Run: `node --test test/semantic-compression-mcp-auth.test.js`

  Expected: FAIL with missing-module or missing-export errors.

- [ ] **Step 3: Implement jose-based Access JWT verification**

  Read only `Cf-Access-Jwt-Assertion`. Resolve `https://${TEAM_DOMAIN}/cdn-cgi/access/certs` from a normalized team domain, use `createRemoteJWKSet`, and call `jwtVerify` with issuer `https://${TEAM_DOMAIN}` and audience `POLICY_AUD`. Never log or return the token or claims. Allow injectable `jwtVerify`/JWKS factories for deterministic tests.

- [ ] **Step 4: Write failing upstream adapter tests**

  Cover valid 200 JSON, 400/413/429/5xx mapping, timeout, invalid JSON, malformed response, empty compressed text, wrong fixed profile, invalid counts, no retry, and assertion that the binding request has no `Authorization` header and body is exactly `{text, profile: "semantic-dense-v1"}`.

- [ ] **Step 5: Implement the Service Binding adapter**

  Call `env.COMPRESSION.fetch()` once with an internal URL, JSON content type, and fixed semantic profile. Parse and validate the minimal REST response without exposing its raw body. Map status 400/413/429/5xx and aborts to safe MCP error categories.

- [ ] **Step 6: Run auth and upstream tests**

  Run: `node --test test/semantic-compression-mcp-auth.test.js test/semantic-compression-mcp-upstream.test.js`

  Expected: all new auth/upstream tests pass; no token, body, or raw upstream payload appears in assertions/log capture.

- [ ] **Step 7: Commit the boundary adapters**

  Commit: `feat: add access auth and compression mcp adapter`

### Task 3: Stateless MCP Worker and tool

**Files:**
- Create: `src/semantic-compression-mcp/server.js`
- Create: `src/semantic-compression-mcp-worker.js`
- Create: `test/semantic-compression-mcp-worker.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 contract and Task 2 `verifyAccessJwt`/`callCompressionService`.
- Produces: default Worker export with `/mcp`, `compress_text` only, stateless `createMcpHandler` factory, and `testMcpRequest`-usable behavior.

- [ ] **Step 1: Write failing Worker/MCP tests**

  Assert `/health`/unknown paths do not expose a tool, missing JWT rejects before handler/binding, `initialize` and `tools/list` expose only `compress_text`, tool schema is strict `{text}`, and `tools/call` returns compressed text plus minimal provenance for a valid authenticated request.

- [ ] **Step 2: Run Worker tests and verify the expected missing implementation failure**

  Run: `node --test test/semantic-compression-mcp-worker.test.js`

  Expected: FAIL because the Worker/server entry points are absent.

- [ ] **Step 3: Implement the stateless server factory**

  Use `McpServer` from `@modelcontextprotocol/server` and `createMcpHandler` from `agents/mcp/server`. Register exactly `compress_text` with the specified concise description and Zod strict input. The callback calls the binding adapter with fixed semantic profile and returns compressed text as the only model-facing content plus minimal structured provenance.

- [ ] **Step 4: Implement the Worker entry point**

  Route only `/mcp`, verify Access JWT before invoking the MCP handler, pass validated auth context without exposing it, and return safe JSON/HTTP failures for authentication and path errors. Construct a fresh server through the handler factory per request; never create a global sessionful server.

- [ ] **Step 5: Add package scripts**

  Add `dev:compression-mcp`, `test:mcp`, and `smoke:mcp` only if their commands are concrete and do not create an alternate production deploy authority. Keep `deploy:production` as the only release command.

- [ ] **Step 6: Run MCP tests and the full suite**

  Run: `npm run test:mcp` and `npm test`

  Expected: MCP tests pass and the existing suite remains green.

- [ ] **Step 7: Commit the Worker/tool implementation**

  Commit: `feat: add stateless semantic compression mcp worker`

### Task 4: Release gate and rollback integration

**Files:**
- Modify: `scripts/deploy-production.mjs`
- Modify: `scripts/release-recovery.mjs`
- Modify: `scripts/smoke-production.mjs`
- Modify: `test/release-recovery.test.js`
- Create or modify: `test/mcp-release.test.js`

**Interfaces:**
- Consumes: MCP config, Worker version parsing, safe unauthenticated readiness response, and operator-provided MCP endpoint/auth smoke state.
- Produces: MCP dry-run/current-version/deploy/rollback metadata fields without treating an unconfigured Access boundary as a successful production release.

- [ ] **Step 1: Write failing release tests**

  Assert MCP config is included in dry-run checks, missing Worker deployment is bootstrap-safe, rollback args target `semantic-compression-mcp` with its config, and release records include `mcpVersionId`, `previousMcpVersionId`, `mcpEndpoint`, `mcpProtocol`, `mcpToolVersion`, `mcpSmoke`, and `mcpRecovery` without credentials.

- [ ] **Step 2: Run release tests and verify missing MCP integration failures**

  Run: `node --test test/mcp-release.test.js test/release-recovery.test.js`

  Expected: FAIL on missing MCP config/version/metadata integration.

- [ ] **Step 3: Add bootstrap-safe MCP version capture, dry-run, deploy, and rollback state**

  Extend the existing single release gate with MCP state and config checks. Capture a missing first deployment as `null`; use `createWorkerRollbackArgs` for MCP. Do not add blind generation retry. Keep authenticated MCP smoke explicitly operator-gated by configured endpoint/Access OAuth evidence; missing Access configuration must remain visible in failed/incomplete metadata, not be reported as PASS.

- [ ] **Step 4: Add safe MCP readiness/smoke hooks**

  Readiness may retry propagation only. A smoke helper must accept an operator-provided authenticated transport or be marked `operator_required`; it must never use a fixed REST token as MCP OAuth and must never retry a tool generation request.

- [ ] **Step 5: Run release tests and existing deploy dry-run checks**

  Run: `node --test test/mcp-release.test.js test/release-recovery.test.js` and the repository’s existing Text/Compression/Gateway dry-run commands with the new MCP dry-run included.

  Expected: release tests pass and all four Worker configurations dry-run without changing REST bindings.

- [ ] **Step 6: Commit release integration**

  Commit: `feat: integrate semantic compression mcp into release gate`

### Task 5: Documentation, local MCP smoke, and external-operation checklist

**Files:**
- Modify: `docs/specs/semantic-compression-mcp.md`
- Modify: `docs/semantic-compression-mcp.md`
- Modify: `docs/semantic-compression.md`
- Modify: `docs/specs/semantic-compression-api.md`
- Create: `scripts/smoke-mcp.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: final Worker endpoint/config and release metadata fields from Tasks 1–4.
- Produces: reproducible local MCP Inspector/HTTP smoke instructions, Codex keyring registration instructions, Access bootstrap checklist, and REST/MCP cross-links.

- [ ] **Step 1: Write failing smoke script tests**

  Test safe handling of unauthenticated endpoint responses, exact MCP endpoint path, no token logging, and expected tool/result validation using injectable fetch.

- [ ] **Step 2: Implement `smoke:mcp`**

  Support only explicit operator-provided endpoint/auth input, redact all auth values, perform initialize/tools/list/tool call once, and stop on errors without retry. Do not make normal `npm test` call external MCP or Gemini.

- [ ] **Step 3: Complete standalone docs**

  Document Cloudflare Access application, Managed OAuth, `TEAM_DOMAIN`, `POLICY_AUD`, Wrangler vars, deployment, MCP Inspector Streamable HTTP, Codex config schema/keyring login/logout/reset, smoke, troubleshooting, rollback, privacy, and the fact that Access configuration is an external completion gate.

- [ ] **Step 4: Run docs/script tests and full regression**

  Run: `npm run test:mcp`, `npm test`, `git diff --check`, and all Worker dry-runs.

  Expected: all pass; no existing REST contract or prompt file changes beyond requested cross-links.

- [ ] **Step 5: Commit documentation and smoke tooling**

  Commit: `docs: document semantic compression remote mcp`

### Task 6: Verification, push, and external completion boundary

**Files:**
- Modify: `docs/superpowers/plans/2026-09-23-semantic-compression-mcp.md` only if evidence updates are needed.

- [ ] **Step 1: Inspect the full diff and verify scope**

  Confirm `src/semantic-compression/prompt.js`, Gemini adapter, REST routes, existing Gateway auth, `dev_agent`, and existing release authority have no unintended changes.

- [ ] **Step 2: Run final verification**

  Run: `npm test`, `npm run test:mcp`, `git diff --check`, four Worker dry-runs, and package-lock audit of MCP dependency versions.

  Expected: fresh command output shows zero test failures, clean diff check, and all dry-runs pass.

- [ ] **Step 3: Commit and push the verified implementation**

  Commit any final verification-only changes if needed, then push the implementation commits to `origin/main` because the user pre-authorized routine pushes.

- [ ] **Step 4: Report external blockers without guessing**

  Report the implementation commit, endpoint after deployment if known, tool/auth/Service Binding/tests/dry-runs, and separately list whether Cloudflare Access application/Managed OAuth/JWT vars, authenticated MCP Inspector smoke, Codex keyring login, and production release/rollback were actually observed. Never claim those are complete from static code alone.
