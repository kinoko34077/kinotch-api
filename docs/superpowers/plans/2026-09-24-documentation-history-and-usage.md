# kinotch-api Documentation History and Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish an evidence-based repository change history and a detailed user/operator guide without changing runtime behavior or public contracts.

**Architecture:** Treat Git first-parent history, `docs/releases/*.json`, and the current source-of-truth specifications as inputs. Publish the full commit inventory in a dedicated history document, keep README as the human entry point with concise operational examples, and link detailed contracts to their existing canonical documents instead of duplicating them.

**Tech Stack:** Git, Markdown, PowerShell-generated evidence, Node test runner.

**Spec:** User request for a comprehensive commit/push-derived log and detailed README/usage documentation.

## Global Constraints

- Do not change Worker code, API request/response contracts, Prompt text, model, auth, limits, Service Bindings, or deploy behavior.
- Use first-parent commits reachable from `origin/main` as the reproducible commit inventory.
- State explicitly that Git records commits and refs, not the complete history of push events.
- Treat `docs/specs/semantic-compression-api.md`, `docs/specs/semantic-compression-mcp.md`, `docs/semantic-compression.md`, and `docs/semantic-compression-mcp.md` as detailed source documents; link to them rather than copying their full Prompt/contracts into README.
- Do not include secrets, tokens, cookies, JWTs, private input, or raw provider output.
- Preserve the repository's production authority: `npm run deploy:production`.

## Review Focus

- A history entry must identify the exact commit and date; do not infer a push date from a commit date.
- A production release entry must be sourced from a tracked `docs/releases/*.json` file, not from an unverified deployment claim.
- README commands must use placeholders for credentials and must distinguish local tests, live tests, smoke, and production deploy.
- REST and Remote MCP authentication paths must remain visibly separate.
- Documentation links must resolve to the current repository paths and must not point to removed or speculative files.

### Task 1: Build the repository history document

**Files:**
- Create: `docs/DEVELOPMENT_HISTORY.md`

**Interfaces:**
- Consumes: `git log --first-parent origin/main`, current `HEAD`, tracked `docs/releases/*.json`, existing `CHANGELOG.md`.
- Produces: a snapshot document containing scope, evidence limits, milestones, release evidence, and one inventory row for every first-parent commit reachable from `origin/main`.

- [x] Capture the current `origin/main` SHA, first-parent commit count, and release metadata filenames.
- [x] Add milestone sections for Gateway/Text Core, semantic compression, Remote MCP, Repository Base, and current hardening.
- [x] Add the complete commit inventory with date, short SHA, subject, and diff stat; retain exact subjects instead of rewriting history.
- [x] Add a release-evidence table that links each tracked release metadata file and records only safe version/status fields.

### Task 2: Publish the detailed usage guide and README entry point

**Files:**
- Create: `docs/USAGE.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: current API/MCP specifications and operations documents.
- Produces: practical local development, REST API, Semantic Compression, Remote MCP, testing, release, rollback, privacy, and troubleshooting guidance.

- [x] Document repository setup, deterministic tests, dry-runs, and the single production deploy authority.
- [x] Document REST endpoint discovery, authentication, request examples, response semantics, limits, errors, warnings, and fallback guidance.
- [x] Document both compression profiles, fixed provider behavior, local live-test credential separation, and secret handling without values.
- [x] Document Remote MCP Access/OAuth/Codex usage separately from REST credentials and link to the full MCP operator guide.
- [x] Update README with architecture, quick-start commands, public surfaces, canonical documentation links, and an explicit non-goals/security section.

### Task 3: Update documentation navigation and current-state references

**Files:**
- Modify: `project/docs/INDEX.md`
- Modify: `project/docs/CURRENT_STATE.md`

**Interfaces:**
- Consumes: the new history and usage documents.
- Produces: navigable Base/project documentation entry points and current documentation status.

- [x] Link the history, usage, API, operations, and MCP documents from the project documentation index.
- [x] Record that the documentation snapshot covers the current `origin/main` and distinguish code completion from external Cloudflare/GitHub operator settings.

### Task 4: Verify documentation only changes

**Files:**
- Test: existing documentation tests and repository test suite.

- [x] Verify all new relative Markdown links resolve to tracked files.
- [x] Run `npm test`.
- [x] Run `git diff --check`.
- [x] Confirm no runtime, Text Core, generated snapshot, or secret-file changes were introduced.
- [x] Commit and push the documentation update, then verify the pushed SHA matches `origin/main` and GitHub checks.
