# Current State

Base version: `0.3.8`

Last verified: 2026-09-24 — release reliability hardening review

## Implemented

- Repository-local KiNoTch Base v0.3.2 and Project Overlay
- API and MCP Surface declarations
- Structured npm setup, test, dev, and deploy command entries
- Existing Hono/Worker, generated snapshot, MCP, and deployment boundaries retained
- Existing Domain files remain at their original paths; no bulk move was performed
- Detailed usage, operations, and first-parent development history are documented under docs/ and linked from this index
- Production smoke uses fixed Gateway, Text Worker, and Compression Worker targets; standalone diagnostic smoke keeps local endpoint overrides separate.
- Production release verifies `main == origin/main`, rebuilds dependencies with `npm ci`, and isolates release-only secrets from build/test child processes.
- Worker deploy results are reconciled against remote active versions; rollback verifies the active version and runs non-billable recovery smoke.
- Remote MCP rate limiting prefers a non-reversible fingerprint of the verified Access subject/email claim and falls back to `CF-Connecting-IP` only when no stable claim exists.
- Repository runtime is pinned to Node 22.18.0 through `package.json`, `.node-version`, and the project-owned CI workflow.
- Current repository hardening revision is `2298101b1e6cbfac2911436cace2bf4f838a2807`; its GitHub Actions `CI` and `Verify` runs both succeeded.

## Default state

- `api`: `OVERRIDE` — HTTP and Worker behavior is Project-owned
- `mcp`: `OVERRIDE` — existing MCP Worker behavior is Project-owned
- `ci-test`: `OVERRIDE` — existing CI workflow is authoritative
- `generated-integrity`: `OVERRIDE` — existing generated snapshot checks are authoritative

## Known constraints

- Public HTTP status and error-code contracts remain unchanged.
- Cloudflare bindings, provider retry, deploy, and rollback policy remain Project-owned.
- Runtime Action contracts are not required by this adoption.
- The latest tracked production release metadata still records source revision `204d15eb382802aa776d5026421e197d52725300`; the current main revision is not production-confirmed until an operator runs the formal release gate.
- GitHub main protection currently requires `test` and `verify`; force push and branch deletion are disabled. PR review, administrator enforcement, strict status, Cloudflare Workers Builds state, Cloudflare Access state, and Base-managed Verify workflow pinning remain external/operator-managed choices.

## Next work

1. Keep GitHub Actions `test` and `Verify` successful; both are currently required checks on `main`.
2. Run `npm run deploy:production` from the current clean `origin/main` only after operator confirmation, then commit the generated release metadata through the normal workflow.
3. Keep API and generated snapshot policy Project-owned.
4. Consider further Default adoption only where it removes a real duplicate.

## Verification

- `knt doctor`
- `knt base-check`
- `knt setup`
- `knt verify`
- `npm test`
- GitHub Actions `test`: success
- GitHub Actions `Verify`: success
- Documentation links and source-of-truth references reviewed with the current repository layout
