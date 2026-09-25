# jev-audit Remote API / MCP Design

Status: approved for implementation (2026-09-25)

The authoritative design was approved in `kinoko34077/jev-audit` on branch `feat/remote-api-mcp`, commit `434c493`, file `docs/superpowers/specs/2026-09-25-remote-api-mcp-design.md`.

This repository owns the Cloudflare implementation. The implementation must preserve the approved constraints: private `jev-audit` Worker, REST `POST /v1/audit`, Remote MCP `/mcp`, explicit file snapshots only, bundled `development`/`generic` profiles only, pinned `jev-1.13.0`, TypeSafe key only on the private Worker, Cloudflare Access on Remote MCP, and no changes to existing semantic-compression behavior.
