# Documentation and Production Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile repository documentation with the accepted `origin/main` state, then release that exact main revision through the existing Production gate and record the resulting evidence.

**Architecture:** Documentation remains repository-owned: `project/docs/CURRENT_STATE.md` is the accepted-state summary, `docs/DEVELOPMENT_HISTORY.md` is the first-parent inventory, and `docs/OPERATIONS.md` remains the release procedure. Production is changed only by `npm run deploy:production`; the generated release metadata is the authoritative deployment evidence.

**Tech Stack:** Markdown, GitHub Actions, Node.js 26, npm, Cloudflare Wrangler, existing release/rollback scripts.

**Spec:** Current repository Control and owner Issue #23, plus the accepted BYOK design and implementation plan under `docs/superpowers/`.

## Global Constraints

- Keep the existing REST, Compression, Remote MCP, Jev Audit, authentication, rate-limit, privacy, and rollback contracts unchanged.
- Do not expose or record secret values, Access tokens, API keys, or request bodies.
- Production authority remains only `npm run deploy:production`.
- Release only from `main` with local `HEAD == origin/main`, clean worktree, passing tests, and passing dry-runs.
- Treat tracked release metadata as deployment evidence; do not claim repository maintenance is Production deployment.
- Do not edit generated snapshots or Base-managed files.

## Review Focus

- A stale Current State must not claim an older accepted main SHA after the documentation merge; test the exact recorded SHA and Production source distinction.
- A first-parent history snapshot must include the BYOK implementation and documentation merge commits; test the listed SHA/subject pairs against `git log`.
- BYOK local self-host must remain explicitly local-only and must not be described as a Production, MCP, Access, or Service Token deployment path; test the guide/spec links and wording.
- Production release metadata must identify the exact pre-release source revision and not be confused with the later metadata-record commit; verify both after release.
- Release failure must preserve existing rollback behavior and leave evidence; do not add a new deploy path or retry policy.

### Task 1: Reconcile accepted repository documentation

**Files:**
- Modify: `project/docs/CURRENT_STATE.md`
- Modify: `docs/DEVELOPMENT_HISTORY.md`
- Modify: `docs/OPERATIONS.md` only if a stale statement is found during the document pass
- Test: existing documentation/current-state tests, plus focused repository checks where available

**Interfaces:**
- Consumes: `origin/main` SHA `13897b973b80a6ea6af504c2f34dece190ad6d64`, PR #53/#54 merge evidence, Issue #23 BYOK E2E evidence, and existing tracked release metadata.
- Produces: documentation stating the accepted main revision, BYOK local capability, CI evidence, and that Production remains at the previously recorded release until the new formal release completes.

- [ ] **Step 1: Write the failing documentation assertions**

  Add or extend the existing documentation checks so they require:
  - `CURRENT_STATE.md` to name the accepted `main` revision `13897b973b80a6ea6af504c2f34dece190ad6d64`.
  - `CURRENT_STATE.md` to identify BYOK local self-host as implemented, locally E2E-verified, and separate from Production.
  - `DEVELOPMENT_HISTORY.md` to identify the current first-parent snapshot as `origin/main` through `13897b9`, including merge commits for PR #53 and #54.
  - no statement that the BYOK implementation itself performed a Production deploy.

- [ ] **Step 2: Run the focused checks and observe the expected failure**

  Run the repository's existing documentation/current-state test command. Expected: FAIL because the current docs still identify `fad4bef` as the accepted main snapshot and omit PR #53/#54 from the first-parent inventory.

- [ ] **Step 3: Update the canonical documents**

  Update only accepted durable facts. Keep the latest formal Production source as the existing tracked release until the new release completes. Add the BYOK implementation and real local E2E evidence without copying secret values or turning local self-host into a hosted feature. Extend the history inventory with the first-parent entries for `7ff67a1`, `7e70f94`, and `13897b9`, preserving exact subjects from Git.

- [ ] **Step 4: Re-run focused checks and the full repository suite**

  Run the focused documentation checks, `npm test`, and `git diff --check`. Expected: all checks pass and only the intended documentation/plan files differ.

- [ ] **Step 5: Commit the documentation reconciliation**

  Commit with `docs: reconcile current state and release history`.

### Task 2: Push, review, merge, and verify the documentation state

**Files:**
- Modify: Git branch/PR state only
- Test: GitHub Actions `test` and `Verify`

**Interfaces:**
- Consumes: Task 1's verified documentation commit.
- Produces: `main` containing the reconciled documents, with successful required checks and a recorded Issue #23 evidence comment.

- [ ] **Step 1: Push the documentation branch and open a PR against `main`**
- [ ] **Step 2: Review the exact PR head and required checks**
- [ ] **Step 3: Merge only after `test` and `Verify` succeed**
- [ ] **Step 4: Fetch `origin/main`, verify clean worktree and exact accepted SHA**

### Task 3: Formal Production release from the reconciled main

**Files:**
- Create: generated `docs/releases/<timestamp>.json` produced by the existing release script
- Modify: no runtime source files

**Interfaces:**
- Consumes: clean `main`, `HEAD == origin/main`, passed CI/Verify, operator-managed mapper values, and the existing `npm run deploy:production` gate.
- Produces: successful release metadata containing the exact source revision, all Worker Version IDs, smoke results, and rollback state.

- [x] **Step 1: Verify release preconditions**

  Confirm `main`, clean worktree, `HEAD == origin/main`, current GitHub `test` and `Verify` success, and required operator values through the existing opaque mapper boundary.

- [x] **Step 2: Run the formal release**

  Run only `npm run deploy:production`. Do not use individual Worker deploys or a new release command. Do not add Provider retries.

- [x] **Step 3: Verify release metadata and live smoke evidence**

  Confirm `status = succeeded`, source revision equals the pre-release main SHA, Text/Compression/MCP/Gateway smoke results pass, private Worker direct checks remain blocked, and no rollback is required.

- [ ] **Step 4: Commit and push the generated release metadata**

  Commit with `chore: record production release`, then re-run `test` and `Verify`. Record that the metadata-record commit is intentionally newer than the deployed source revision.

### Task 4: Reconcile post-release documentation and durable issue evidence

**Files:**
- Modify: `project/docs/CURRENT_STATE.md`
- Modify: `docs/DEVELOPMENT_HISTORY.md`

**Interfaces:**
- Consumes: Task 3 release metadata and post-merge CI/Verify evidence.
- Produces: current-state and history records that distinguish deployed source SHA from the later metadata-record commit.

- [x] **Step 1: Update Current State with the successful release evidence**
- [x] **Step 2: Extend the first-parent history snapshot through the metadata commit**
- [x] **Step 3: Run `npm test`, `git diff --check`, and repository verification**
- [x] **Step 4: Commit/push the post-release documentation and comment Issue #23 with the final evidence**
