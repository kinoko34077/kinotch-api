# npm Dependency Supply-Chain Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a low-noise npm dependency-maintenance and dependency-delta vulnerability review path to `kinotch-api` without changing runtime, release, deployment, Cloudflare, repository-admin, or existing authoritative CI behavior.

**Architecture:** Dependabot owns bounded npm version-update PR creation; a path-filtered dependency-review workflow evaluates only `package.json` / `package-lock.json` pull requests. Existing `CI` and `Verify` remain the build/test authorities. Planning artifacts are merged first; implementation then starts on a fresh branch so planning and implementation diffs remain responsibility-separated.

**Tech Stack:** GitHub Dependabot, GitHub Actions, `actions/checkout`, `actions/dependency-review-action`, npm / package-lock v3.

**Spec:** `docs/superpowers/specs/2026-09-26-npm-dependency-supply-chain-hardening-design.md`

## Global Constraints

- Design audit base: `3a46902db2ac51d7251cfd79dfb4660f191bc748`.
- Before implementation, merge only the approved design/plan PR #35, then create a fresh implementation branch from the resulting `main`; if any unrelated `main` change appears, inspect its relevant impact first.
- Root dependency ecosystem only: npm manifest/lockfile at `/`.
- Dependabot cadence `weekly`; open version-update PR limit `3`; group minor/patch updates; keep majors separate.
- Dependency review runs only for PRs changing `package.json` or `package-lock.json`.
- Vulnerability policy: `vulnerability-check: true`, `license-check: false`, `fail-on-severity: low`.
- Workflow permission: `contents: read`; no PR-write permission or PR comments.
- New Action pins:
  - `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`
  - `actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294 # v5.0.0`
- Do not modify `.github/workflows/verify.yml`, Base/common CI internals, branch protection, required checks, Secrets, credentials, repository permissions, release/deploy logic, Cloudflare state, or feature Issues #29/#31/#9.
- Do not add CodeQL or GitHub-Actions Dependabot in this pilot.
- Do not add committed string/YAML tests solely to assert configuration text.
- No production release or deploy command is run.

## Review Focus

1. **Noise control:** minor/patch version updates group; major updates remain separate.
2. **Trigger boundary:** either manifest-only or lockfile-only changes trigger dependency review; unrelated PRs do not.
3. **Privilege boundary:** dependency review stays read-only with no PR-write/admin permission.
4. **Supply-chain immutability:** every newly introduced Action is pinned to a verified 40-hex commit SHA.
5. **Responsibility separation:** existing CI owns build/test; dependency review contains no duplicate test/deploy/release work.

---

### Task 0: Finalize planning artifacts and establish a clean implementation base

**Files:**
- Existing: `docs/superpowers/specs/2026-09-26-npm-dependency-supply-chain-hardening-design.md`
- Existing: `docs/superpowers/plans/2026-09-26-npm-dependency-supply-chain-hardening.md`

**Interfaces:**
- Consumes: approved spec and approved plan.
- Produces: planning artifacts on `main` plus a fresh implementation branch containing no hardening implementation yet.

- [ ] **Step 1: Confirm PR #35 contains planning artifacts only**

Expected changed files: exactly the design and plan documents. No `.github` hardening implementation, product source, manifest, lockfile, deploy/release, or Current State change.

- [ ] **Step 2: Run/confirm existing required checks for PR #35**

Expected: repository-required `test` and `verify` checks are green.

- [ ] **Step 3: Merge PR #35 using its verified final head**

No release/deploy follows this merge.

- [ ] **Step 4: Create a fresh implementation branch from the new `main`**

Suggested name: `hardening/issue-34-npm-supply-chain`.

Expected: implementation branch base contains the approved spec/plan and no implementation delta.

### Task 1: Add low-noise root npm Dependabot policy

**Files:**
- Create: `.github/dependabot.yml`

**Interfaces:**
- Consumes: root `package.json` and `package-lock.json`.
- Produces: weekly root npm version-update PRs; grouped minor/patch updates and separate major updates.

- [ ] **Step 1: Reconfirm current base and configuration absence**

Fetch `main`, Issue #34, open PRs, and `.github/dependabot.yml`. If an equivalent configuration appeared, stop and reconcile rather than duplicate it.

- [ ] **Step 2: Recheck current official Dependabot syntax**

Confirm `npm`, `/`, `weekly`, `open-pull-requests-limit`, `groups.patterns`, `applies-to: version-updates`, and `update-types: [minor, patch]` remain valid.

- [ ] **Step 3: Create `.github/dependabot.yml`**

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 3
    groups:
      minor-and-patch:
        applies-to: version-updates
        patterns:
          - "*"
        update-types:
          - "minor"
          - "patch"
```

Do not add private registries, auto-merge, labels, credentials, release behavior, or a GitHub Actions ecosystem entry.

- [ ] **Step 4: Targeted review**

Verify the six pinned semantics: npm only, root only, weekly, limit 3, version-update group only, minor/patch only.

- [ ] **Step 5: Commit**

```bash
git add .github/dependabot.yml
git commit -m "chore: configure npm dependabot updates"
```

### Task 2: Add path-scoped dependency vulnerability review

**Files:**
- Create: `.github/workflows/dependency-review.yml`

**Interfaces:**
- Consumes: PR dependency deltas represented by `package.json` and `package-lock.json`.
- Produces: a read-only vulnerability-review job that fails on newly introduced vulnerabilities at `low` severity or above.

- [ ] **Step 1: Re-resolve Action provenance immediately before writing**

Confirm:
- `actions/checkout` `v7.0.1` → `3d3c42e5aac5ba805825da76410c181273ba90b1`;
- `actions/dependency-review-action` `v5.0.0` → `a1d282b36b6f3519aa1f3fc636f609c47dddb294`;
- dependency-review v5 remains supported for public repositories and the current GitHub-hosted runner.

If any mapping/compatibility changed, stop and revise the approved artifacts rather than silently substituting a version.

- [ ] **Step 2: Create `.github/workflows/dependency-review.yml`**

```yaml
name: Dependency Review

on:
  pull_request:
    paths:
      - "package.json"
      - "package-lock.json"

permissions:
  contents: read

jobs:
  dependency-review:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - name: Review dependency changes
        uses: actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294 # v5.0.0
        with:
          vulnerability-check: true
          license-check: false
          fail-on-severity: low
```

Do not add PR comments, write permissions, `npm test`, deploy, release, or Cloudflare steps.

- [ ] **Step 3: Targeted workflow review**

Verify exact two path triggers, `contents: read`, two full-SHA Action refs, explicit vulnerability-only policy, and absence of duplicate build/deploy behavior.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/dependency-review.yml
git commit -m "ci: add dependency vulnerability review"
```

### Task 3: Verify, review, and merge the implementation

**Files:**
- Verify: `.github/dependabot.yml`
- Verify: `.github/workflows/dependency-review.yml`
- Must remain unchanged: `.github/workflows/ci.yml`, `.github/workflows/verify.yml`, product source, `package.json`, `package-lock.json`.

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: accepted hardening on `main` without protected/admin-state changes.

- [ ] **Step 1: Run existing repository verification**

```bash
npm ci
npm test
```

Then on the supported PowerShell entry:

```powershell
./.kinotch/scripts/knt.ps1 verify
```

Expected: all pass.

- [ ] **Step 2: Verify implementation diff**

Expected implementation files: only `.github/dependabot.yml` and `.github/workflows/dependency-review.yml`.

- [ ] **Step 3: Open the implementation PR**

Reference Issue #34, spec, plan, Action provenance, verification evidence, changed-scope boundary, and revert-PR rollback. State explicitly that no admin/Secret/release/deploy/Cloudflare change occurred.

- [ ] **Step 4: Fresh review on exact final head**

Review configuration semantics, path boundary, least privilege, immutable pins, duplicate-signal avoidance, and scope. Resolve all blocking findings and re-review if head changes.

- [ ] **Step 5: Confirm current required checks are green**

Keep existing `test` and `verify` authoritative. Do not add dependency review to branch protection in this task.

- [ ] **Step 6: Merge only the verified final head**

Use expected-head protection when available. Do not deploy or release.

### Task 4: Post-merge acceptance and Current State reconciliation

**Files:**
- Modify after implementation acceptance: `project/docs/CURRENT_STATE.md`
- Update: Issue #34
- Update if cross-repo summary changed: `devflow#18`

**Interfaces:**
- Consumes: merged implementation SHA and post-merge CI evidence.
- Produces: durable accepted repository state without rewriting Production evidence.

- [ ] **Step 1: Verify merged `main`**

Confirm both new configuration files are present with approved semantics, post-merge CI/Verify are green, and protected required-check/admin settings were not changed by this work.

- [ ] **Step 2: Record only accepted durable facts in Current State**

Add that root npm Dependabot runs weekly with PR limit 3 and grouped minor/patch version updates; dependency-changing PRs have read-only path-scoped vulnerability review using immutable Action pins; CodeQL/required-check promotion remain deferred; no Production release/deploy claim follows from this hardening.

Do not alter historical release evidence.

- [ ] **Step 3: Submit the Current State update as a small follow-up docs PR**

This follows the design rule that Current State records accepted behavior only after implementation is merged and verified.

Expected: required checks green; no product files changed.

- [ ] **Step 4: Close Issue #34 and reconcile `devflow#18` if required**

Record implementation PR/merge SHA, post-merge evidence, and Current State PR. Update `devflow#18` only for fields that actually changed under devflow rules.

- [ ] **Step 5: Stop at the approved pilot boundary**

Do not add CodeQL, GitHub Actions Dependabot, security-setting mutation, required-check promotion, or deeper locking. Any extension requires a separate repo-local Issue justified by observed signal.
