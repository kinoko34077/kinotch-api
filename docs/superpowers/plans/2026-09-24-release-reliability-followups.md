# Release reliability follow-ups

## Goal

Close the repository-fixable findings from the 2026-09-24 production audit without changing the public API, Compression profiles, provider settings, Service Bindings, or Text Core behavior.

## Constraints

- Do not run `npm run deploy:production` in this plan.
- Do not edit Base-managed `.kinotch/**`, `AGENTS.md`, or the Base-managed Verify workflow.
- Keep production smoke endpoint overrides available only to standalone local smoke; production release uses fixed targets.
- Keep provider generation retry policy unchanged.
- Use tests first for behavior changes.

## Tasks

- [x] Add failing tests for strict MCP endpoint ports, release-child environment allowlisting, Node runtime declaration, rollback verification, and deployment reconciliation.
- [x] Implement the test-backed endpoint, environment, Node, rollback, and deployment reconciliation hardening.
- [x] Update Current State, development history, and operations documentation with the current release boundary and recovery behavior.
- [ ] Run focused tests, full regression, generated checks, dry-runs, and `git diff --check`.
- [ ] Commit and push the repository changes; verify the resulting GitHub checks.

## External items intentionally not changed

- Production deployment from the current main revision.
- GitHub branch protection required-check configuration.
- Base-managed Verify workflow action pinning and Node warning.
- Cloudflare Access / Workers Builds dashboard state.
