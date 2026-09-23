# Current State

Base version: `0.3.8`

Last verified: 2026-09-24 — documentation history and usage guide

## Implemented

- Repository-local KiNoTch Base v0.3.2 and Project Overlay
- API and MCP Surface declarations
- Structured npm setup, test, dev, and deploy command entries
- Existing Hono/Worker, generated snapshot, MCP, and deployment boundaries retained
- Existing Domain files remain at their original paths; no bulk move was performed
- Detailed usage, operations, and first-parent development history are documented under docs/ and linked from this index

## Default state

- `api`: `OVERRIDE` — HTTP and Worker behavior is Project-owned
- `mcp`: `OVERRIDE` — existing MCP Worker behavior is Project-owned
- `ci-test`: `OVERRIDE` — existing CI workflow is authoritative
- `generated-integrity`: `OVERRIDE` — existing generated snapshot checks are authoritative

## Known constraints

- Public HTTP status and error-code contracts remain unchanged.
- Cloudflare bindings, provider retry, deploy, and rollback policy remain Project-owned.
- Runtime Action contracts are not required by this adoption.

## Next work

1. Keep GitHub Actions `test` and `Verify` successful; make both required checks in branch protection when operator-managed settings are updated.
2. Keep API and generated snapshot policy Project-owned.
3. Consider further Default adoption only where it removes a real duplicate.

## Verification

- `knt doctor`
- `knt base-check`
- `knt setup`
- `knt verify`
- `npm test`
- GitHub Actions `test`: success
- GitHub Actions `Verify`: success
- Documentation links and source-of-truth references reviewed with the current repository layout
