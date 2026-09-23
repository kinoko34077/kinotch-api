# Project Specification

Status: active — first repository-local Base adoption

## Purpose

kinotch-api provides Cloudflare Worker gateways and text transformation
services, with Hono routing, generated clients/snapshots, and MCP endpoints.

## Acceptance

1. Existing HTTP, MCP, generated snapshot, and binding behavior remains unchanged.
2. `knt doctor` validates the local Project Overlay and Base.
3. `knt verify` reaches the existing npm test suite.
4. Public status, error codes, request IDs, and response shapes remain Project-owned.

## Ownership boundary

- Hono Context, HTTP transport, auth, rate limits, bindings, retries, and deploy
  policy remain in the existing repository root.
- KiNoTch Base files and repository operations live under `.kinotch/`.
- The Project Manifest, contracts, and adoption state live under `project/`.
- No Worker or Domain file is moved merely to satisfy the Base structure.

## Commands

- Setup: `npm ci`
- Test: `npm test`
- Verify: `knt verify` (test fallback)

## Constraints

The Runtime is not a required dependency. API error serialization and provider
behavior must not be changed to fit a Runtime envelope.
