# MCP bootstrap and initialize lifecycle plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate the one-time Remote MCP Worker bootstrap from the strict normal production release gate, and make the authenticated smoke follow the MCP initialize lifecycle by sending `notifications/initialized` before discovery and tool use.

**Architecture:** Add an explicit, fail-closed `bootstrap:mcp` command that deploys only the MCP Worker before Access application setup. Keep `npm run deploy:production` strict: it still requires Access configuration and authenticated smoke. Update the existing stateless smoke helper and its tests/docs without changing REST or compression behavior.

**Tech Stack:** Node.js scripts, Wrangler, Cloudflare Workers, Node test runner, Streamable HTTP MCP.

## Constraints

- Do not change `/v1/compress`, compression prompts, model, Service Binding, Access JWT validation, or provider behavior.
- Do not create a second ordinary production release authority. `npm run deploy:production` remains the only normal production release command; `bootstrap:mcp` is one-time pre-Access setup only.
- Bootstrap must fail closed on missing explicit operator confirmation and must not require post-Access endpoint/cookie values.
- Normal release must continue to require `TEAM_DOMAIN`, `POLICY_AUD`, `MCP_ENDPOINT`, and `MCP_SMOKE_ACCESS_COOKIE`.
- Never log or persist cookies, JWTs, API keys, or private text.
- MCP smoke must send exactly one initialize request, one `notifications/initialized` notification, one `tools/list`, and one `tools/call`, with no retry.

### Task 1: Add failing tests for bootstrap separation and lifecycle order

**Files:**
- Modify: `test/mcp-release.test.js`
- Modify: `test/smoke-mcp.test.js`
- Create: `test/mcp-bootstrap.test.js`

- [x] Test that the bootstrap command requires explicit confirmation, does not require `MCP_ENDPOINT` or `MCP_SMOKE_ACCESS_COOKIE`, and never includes Access vars unless explicitly provided.
- [x] Test that normal `resolveMcpSmokeInputs` remains strict.
- [x] Update the smoke fixture to accept a notification and assert the order `initialize -> notifications/initialized -> tools/list -> tools/call`.
- [x] Run the focused tests and confirm the new expectations fail before implementation.

### Task 2: Implement an explicit fail-closed MCP bootstrap command

**Files:**
- Create: `scripts/bootstrap-mcp.mjs`
- Modify: `package.json`

- [x] Add bootstrap argument/validation helpers with an explicit `MCP_BOOTSTRAP_CONFIRM=true` guard.
- [x] Require the production source gate and clean worktree before deployment.
- [x] Run MCP dry-run, verify the Worker has not already been deployed, then deploy only `semantic-compression-mcp` without fabricating Access vars or smoke success.
- [x] Record only safe bootstrap state if metadata is written; never mark the overall production release `succeeded`.
- [x] Add `bootstrap:mcp` and document that it is not a replacement for the normal release gate.

### Task 3: Formalize MCP initialized notification

**Files:**
- Modify: `scripts/smoke-mcp.mjs`
- Modify: `test/smoke-mcp.test.js`

- [x] Send a JSON-RPC `notifications/initialized` notification without an `id` after a successful initialize response.
- [x] Accept the notification's empty/acknowledgement response safely without parsing provider/upstream bodies.
- [x] Keep one-shot behavior and preserve safe error normalization.

### Task 4: Update operational and API documentation

**Files:**
- Modify: `docs/semantic-compression-mcp.md`
- Modify: `docs/specs/semantic-compression-mcp.md`

- [x] Document the bootstrap sequence: bootstrap deploy, Access application, Managed OAuth, Worker vars, authenticated smoke, then normal production release.
- [x] Document the initialized notification in the smoke lifecycle.
- [x] Keep normal release requirements and OAuth/session-cookie evidence distinction explicit.

### Task 5: Verify, commit, and push

- [x] Run focused MCP tests, `npm test`, `git diff --check`, and the MCP dry-run if available without external deployment.
- [x] Confirm Text Core and REST/compression files are unchanged.
- [ ] Commit the scoped change and push it to `origin/main`.
- [ ] Verify the pushed SHA and GitHub Actions `test` result.
- [x] Do not run `npm run deploy:production`; Access bootstrap and authenticated production smoke remain operator-gated.
