# Jev Audit Remote history + rolling benchmark implementation plan

Status: repository implementation verified; Production rollout pending

Owning work: `kinotch-api#29`, parent `devflow#63`
Base: latest accepted `main` (`7e06351215a26911b8960bacd40bc5ea634098c3`)
Design: `docs/superpowers/specs/2026-09-26-jev-audit-history-rolling-benchmark-design.md`

## Goal

Implement side-channel structured history and one-fixture rolling benchmark inside the private Jev Worker while preserving REST/MCP response contracts, Service Token auth, explicit-snapshot semantics, provider validation, limits, and release authority.

## Task 1 — shared fixed benchmark contract

Files:
- add `src/jev-audit/benchmark.js`
- add benchmark-focused tests
- minimally export/reuse the existing pinned `callSystemOne` provider path from `src/jev-audit/evaluator.js`

TDD:
1. RED for eight fixed fixture IDs, fixed expectations independent of caller profile, 100/0/null scoring, and pinned-model validation.
2. Run at most one small synthetic fixture after a successful real provider-backed audit.
3. Provider failure returns a bounded benchmark error classification and never changes the real AuditReport.
## Task 2 — rolling state and structured event projection

Files:
- add `src/jev-audit/observability.js`
- add/update private-worker tests

TDD:
1. RED for KV state read/write, fixture rotation, rolling max 10, null-preserving numeric mean, state read/write failure isolation, and compact event projection.
2. Use one logical KV record only; no source/diff/path/auth/provider raw body may enter state or history event.
3. Emit one stable `jev_audit_history` structured JSON event after a completed real audit; observability failure must not change the caller result.

## Task 3 — trusted surface plumbing

Files:
- modify `src/routes/api.js`
- modify `src/jev-audit-mcp/upstream.js`
- modify `src/jev-audit-worker.js`
- update REST/MCP/private-worker tests

TDD:
1. RED that Gateway supplies `rest` and MCP supplies `remote_mcp` through a project-internal header.
2. Restrict the private worker to the exact trusted surface values; direct test/internal calls may fall back to `unknown` only where explicitly exercised.
3. Keep public request bodies and external response schemas unchanged.
## Task 4 — deployment-config boundary and docs

Repository implementation may prepare code/tests/docs for the `JEV_AUDIT_BENCHMARK_STATE` binding, but must not create/attach a Production KV namespace or deploy it without separate explicit approval.

Files:
- update `wrangler.jev-audit.jsonc` only when a real approved namespace id/resource exists; do not commit a fake Production id
- otherwise document the pending binding as rollout work and test missing-binding degradation safely
- update Jev Remote docs and `project/docs/CURRENT_STATE.md`
- update approved design status after repository verification

Verification:
- focused Jev tests
- full `npm test`
- `git diff --check`
- Worker dry-run/config validation that does not mutate Production
- GitHub `test` + `Verify`
- changed-scope auth/privacy/result-contract review

## Completion boundary

Open a dedicated PR for `kinotch-api#29` and merge verified repository code if safely revertible. Stop before Production KV resource creation/attachment, credential/permission mutation, or deploy/release; those remain a later explicit user-confirmation phase.