# npm Dependency Supply-Chain Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a low-noise npm dependency-maintenance and dependency-delta vulnerability review path to `kinotch-api` without changing runtime, release, deployment, Cloudflare, repository-admin, or existing authoritative CI behavior.

**Architecture:** Keep dependency update discovery and dependency-change risk review separate. Dependabot owns bounded npm version-update PR creation; a path-filtered dependency-review workflow evaluates only `package.json` / `package-lock.json` pull requests. Existing `CI` and `Verify` remain the build/test authorities.

**Tech Stack:** GitHub Dependabot, GitHub Actions, `actions/checkout`, `actions/dependency-review-action`, npm / package-lock v3.

**Spec:** `docs/superpowers/specs/2026-09-26-npm-dependency-supply-chain-hardening-design.md`

## Global Constraints

- Repository base before implementation: `main` at `3a46902db2ac51d7251cfd79dfb4660f191bc748`; if `main` moves, re-read the changed relevant scope before writing implementation files.
- Root dependency ecosystem only: npm manifest/lockfile at `/`.
- Dependabot cadence: `weekly`.
- Dependabot open version-update PR limit: `3`.
- Minor and patch version updates are grouped; major version updates remain separate.
- Dependency review runs only for pull requests changing `package.json` or `package-lock.json`.
- Dependency review is vulnerability-focused: `vulnerability-check: true`, `license-check: false`, `fail-on-severity: low`.
- Dependency-review workflow permissions remain `contents: read`; do not add `pull-requests: write` or PR comments.
- New third-party Actions use immutable full commit SHAs with release comments:
  - `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`
  - `actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294 # v5.0.0`
- Do not modify `.github/workflows/verify.yml`, Base/common CI internals, branch protection, required checks, Secrets, credentials, repository permissions, release/deploy logic, or Cloudflare state.
- Do not add CodeQL in this pilot.
- Do not add committed string/YAML unit tests solely to assert configuration text.
- No production release or deploy command is run as part of this plan.

## Review Focus

1. **Noise control:** minor/patch updates group into one routine version-update PR while majors remain independent; verify from `dependabot.yml` group/update-types semantics.
2. **Trigger boundary:** dependency review runs for either manifest-only or lockfile-only PR changes and does not run for unrelated PRs; verify exact `pull_request.paths` entries.
3. **Privilege boundary:** the workflow remains read-only and does not gain PR-write/admin permissions; verify the `permissions` block and absence of comment-summary configuration.
4. **Supply-chain immutability:** every Action newly added by this task is a 40-hex commit pin whose documented release mapping was rechecked immediately before implementation.
5. **Responsibility separation:** existing CI continues to run tests/dry-runs; dependency review contains no duplicate `npm test`, deploy, release, Cloudflare, or feature-specific steps.

---

### Task 1: Add low-noise root npm Dependabot policy

**Files:**
- Create: `.github/dependabot.yml`

**Interfaces:**
- Consumes: root `package.json` and `package-lock.json` on the default branch.
- Produces: weekly Dependabot version-update PRs for the root npm ecosystem; grouped minor/patch updates and separate major updates.

- [ ] **Step 1: Reconfirm the implementation base and absence of competing configuration**

Fetch current `main`, `.github/dependabot.yml`, Issue `#34`, and open PRs. Continue only if no equivalent configuration has appeared; if `main` moved, inspect the relevant diff before proceeding.

- [ ] **Step 2: Recheck current GitHub Dependabot syntax**

Confirm the official GitHub options still support `package-ecosystem: npm`, `directory: /`, `schedule.interval: weekly`, `open-pull-requests-limit`, and a version-update group with `patterns: ["*"]` plus `update-types: ["minor", "patch"]`.

Expected: all selected keys remain supported with the same semantics.

- [ ] **Step 3: Create `.github/dependabot.yml` with the approved policy**

Use exactly this policy shape:

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

Do not add private registries, auto-merge, labels, release behavior, credentials, or a GitHub Actions ecosystem entry.

- [ ] **Step 4: Perform targeted configuration review**

Verify:
- only one `npm` update entry exists;
- directory is `/`;
- interval is `weekly`;
- open PR limit is `3`;
- group applies only to version updates;
- only `minor` and `patch` are grouped, leaving majors ungrouped.

Expected: all six conditions hold; no unrelated configuration exists.

- [ ] **Step 5: Commit Task 1**

```bash
git add .github/dependabot.yml
git commit -m "chore: configure npm dependabot updates"
```

### Task 2: Add path-scoped dependency vulnerability review

**Files:**
- Create: `.github/workflows/dependency-review.yml`

**Interfaces:**
- Consumes: pull-request dependency deltas represented by `package.json` and `package-lock.json`.
- Produces: a read-only dependency-review job that fails when a newly introduced dependency has a vulnerability at `low` severity or above.

- [ ] **Step 1: Re-resolve Action release provenance immediately before writing**

Recheck:
- `actions/checkout` release `v7.0.1` still maps to `3d3c42e5aac5ba805825da76410c181273ba90b1`;
- `actions/dependency-review-action` release `v5.0.0` still maps to `a1d282b36b6f3519aa1f3fc636f609c47dddb294`;
- dependency-review v5 remains supported for public repositories and GitHub-hosted runners.

If any mapping or compatibility has changed, stop and update the plan/spec before substituting a different Action version.

- [ ] **Step 2: Create `.github/workflows/dependency-review.yml`**

Use this behavior and exact pins:

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

Do not add PR comments, write permissions, `npm test`, deployment, release, or Cloudflare steps.

- [ ] **Step 3: Perform targeted workflow review**

Verify:
- both `package.json` and `package-lock.json` are path triggers;
- no unrelated path is present;
- permissions are exactly `contents: read`;
- both `uses:` refs are full 40-character SHAs;
- vulnerability review is enabled, license review disabled, severity threshold explicit;
- there is no build/test duplication and no admin/deploy behavior.

Expected: all conditions hold.

- [ ] **Step 4: Commit Task 2**

```bash
git add .github/workflows/dependency-review.yml
git commit -m "ci: add dependency vulnerability review"
```

### Task 3: Verify and review the implementation PR

**Files:**
- Verify: `.github/dependabot.yml`
- Verify: `.github/workflows/dependency-review.yml`
- Do not modify: `.github/workflows/ci.yml`
- Do not modify: `.github/workflows/verify.yml`

**Interfaces:**
- Consumes: Task 1 and Task 2 configuration.
- Produces: reviewed, merge-ready implementation evidence without changing protected/admin state.

- [ ] **Step 1: Run the existing repository test authority**

Run:
```bash
npm ci
npm test
```

Expected: existing test suite passes with no product/runtime change.

- [ ] **Step 2: Run repository verification through the existing Base entry point**

Run on the supported shell:
```powershell
./.kinotch/scripts/knt.ps1 verify
```

Expected: PASS.

- [ ] **Step 3: Verify changed scope**

Inspect the implementation diff. Expected changed implementation files are only:
- `.github/dependabot.yml`
- `.github/workflows/dependency-review.yml`

The design/plan documents may be present from the already-approved documentation PR, but there must be no product source, manifest, lockfile, release, deploy, Cloudflare, Base/common CI, or feature-Issue implementation change.

- [ ] **Step 4: Open the implementation PR against current `main`**

PR body must reference Issue `#34`, the design and plan paths, exact Action provenance, test/verify evidence, changed-scope boundary, rollback by revert PR, and explicit statement that no admin/release/deploy/Secret change occurred.

- [ ] **Step 5: Require fresh review on the final head**

Review focus: configuration semantics, path boundary, least privilege, immutable Action pins, no duplicated CI signal, and no scope creep.

Expected: no unresolved blocking finding on the exact final PR head.

- [ ] **Step 6: Confirm repository-required checks are green before merge**

Required current checks include repository `test` and `verify`; do not promote dependency review to a new protected required check in this task.

Expected: all existing required checks green.

- [ ] **Step 7: Merge only the verified final head**

Use expected-head protection when available. Do not deploy or release after merge.

### Task 4: Post-merge acceptance and Current State reconciliation

**Files:**
- Modify after implementation merge: `project/docs/CURRENT_STATE.md`
- Update tracking: repository Issue `#34`
- Update cross-repo summary only if needed: `devflow#18`

**Interfaces:**
- Consumes: merged implementation commit and post-merge CI evidence.
- Produces: durable accepted repository state without rewriting Production evidence.

- [ ] **Step 1: Verify merged `main`**

Confirm:
- `.github/dependabot.yml` exists on `main` with the approved npm policy;
- `.github/workflows/dependency-review.yml` exists on `main` with exact immutable Action pins;
- post-merge existing CI/Verify are green;
- branch protection / required-check configuration has not been changed by this work.

Expected: all conditions hold.

- [ ] **Step 2: Record accepted repository state**

In `project/docs/CURRENT_STATE.md`, add only the durable facts that:
- root npm Dependabot weekly version updates are enabled with PR limit `3` and grouped minor/patch updates;
- dependency-changing PRs are covered by the path-scoped vulnerability review workflow;
- the workflow uses read-only permissions and immutable Action pins;
- CodeQL and required-check promotion remain deferred/not adopted;
- no Production release/deploy claim is implied by this repository hardening.

Do not alter historical release evidence or imply the hardening was deployed to Cloudflare.

- [ ] **Step 3: Put the Current State update through the normal PR/check path**

Because the design requires Current State to describe accepted behavior only after implementation is merged and verified, make this a small follow-up docs-only PR rather than pre-claiming acceptance in the implementation PR.

Expected: existing required checks green; no product files changed.

- [ ] **Step 4: Close Issue `#34` and reconcile `devflow#18`**

Record implementation PR, merge SHA, verification evidence, and the Current State reconciliation PR. Close `#34` as completed. Update `devflow#18` only if its Audit SHA / Active Work / Next Action / Detailed Current State needs reconciliation under devflow rules.

- [ ] **Step 5: Stop at the approved pilot boundary**

Do not add CodeQL, GitHub Actions Dependabot, security-setting mutations, required-check promotion, or deeper dependency locking as part of closure. Open a separate Issue later only if observed signal justifies one of those extensions.
