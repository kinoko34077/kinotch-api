# npm Dependency Supply-Chain Hardening Design

Date: 2026-09-26
Repository: `kinoko34077/kinotch-api`
Status: design review
Owning Issue: `#34`
Audit base: `3a46902db2ac51d7251cfd79dfb4660f191bc748`

## 1. Purpose

Add a repository-local, low-noise supply-chain hardening pilot for the real npm dependency surface in `kinotch-api` without changing Production behavior, deployment/release behavior, repository-admin security settings, or the existing authoritative build/test gates.

This design applies the repository-specific adoption rule recorded by `devflow#100`: add only dependency/security mechanisms that provide distinct signal, and do not bulk-add noisy mandatory gates.

## 2. Current state and constraints

- `kinotch-api` is a public GitHub repository with a root npm dependency surface.
- `package.json` has runtime dependencies including `@modelcontextprotocol/server`, `agents`, `hono`, `jose`, and `zod`, plus development dependencies including `wrangler`.
- `package-lock.json` is lockfile version 3 and records the transitive dependency graph and integrity metadata.
- Existing project CI already runs `npm ci`, `npm test`, Base compatibility checks, and Worker dry-runs. It remains authoritative for runtime/build/test behavior.
- The current repository has only `ci.yml` and `verify.yml`; there is no repository-local Dependabot configuration or dependency-review workflow.
- `verify.yml` currently contains a mutable `actions/checkout@v4` reference, but repository instructions place common CI outside normal project-local edit scope. This pilot therefore does not rewrite Base/common CI. Any Base-wide immutable-action policy is a separate owning task.
- Existing feature work (`#29`, `#31`, and machine-local `#9`) retains its own responsibility. This hardening work must not modify their contracts or implementation.

## 3. Selected approach

Use two complementary mechanisms, both scoped to npm dependency changes:

1. **Dependabot version updates** for the root npm manifest/lockfile.
2. **Dependency review on pull requests** that change `package.json` or `package-lock.json`.

Do not add CodeQL in the initial pilot. Code scanning is broader than the dependency-delta problem and is deferred until a repository-specific risk/signal case justifies it.

Do not promote the dependency-review workflow to a protected required check in this task. Repository-admin and branch-protection changes remain a separate explicit authorization boundary.

## 4. Dependabot design

Create `.github/dependabot.yml` with one npm update entry for `/`.

Policy:

- ecosystem: `npm`
- directory: `/`
- cadence: `weekly`
- keep the open Dependabot version-update PR limit small; initial target: `3`
- group compatible minor/patch version updates where GitHub supports grouping
- keep major-version updates distinct rather than silently grouping them with routine minor/patch maintenance
- do not configure deployment, release, auto-merge, credentials, or private registries

The purpose is not to keep every dependency at the newest possible version. The purpose is to surface bounded, reviewable dependency-maintenance PRs at a cadence compatible with a small repository.

Dependabot-created PRs must pass the same existing repository CI as human-created dependency PRs. Dependabot does not replace `npm ci`, `npm test`, `verify`, or project-owned dry-run checks.

## 5. Dependency-review workflow design

Add `.github/workflows/dependency-review.yml`.

Trigger:

- `pull_request`
- only when `package.json` or `package-lock.json` changes

Behavior:

- run GitHub's dependency-review action against the PR dependency delta;
- fail the workflow when the action detects a newly introduced dependency version with a known vulnerability according to the selected action policy;
- use least-privilege workflow permissions, starting from read-only repository contents and adding only permissions proven necessary by the selected action;
- pin every newly introduced third-party GitHub Action to an immutable full commit SHA and retain the human-readable release tag in a comment for provenance;
- avoid unrelated build/test work in this workflow.

GitHub's current documentation states that dependency review reports direct and indirect dependency changes represented by manifests/lockfiles, and that the dependency-review action can fail when a newly introduced dependency has a known vulnerability. Because this repository is public, the dependency-review action is within the currently documented availability boundary.

The workflow is dependency-delta evidence, not a duplicate build/test job. It does not run `npm test` itself because existing CI already supplies that signal.

## 6. Signal and failure semantics

The pilot answers two separate questions:

- **Update signal:** Is there a bounded dependency update worth reviewing? → Dependabot PR.
- **Introduction-risk signal:** Does a PR add/update a dependency in a way that introduces a known vulnerability? → dependency-review check.

A dependency-review failure is a dependency-risk finding on that PR. It does not by itself mutate branch protection or repository settings.

If the dependency-review action becomes unavailable because GitHub changes platform/account capability, the workflow must fail visibly rather than silently claim review coverage. The implementation plan must re-check feature availability before implementation.

## 7. Responsibility boundaries

This task owns only:

- `.github/dependabot.yml`;
- a repository-local dependency-review workflow;
- minimal repository documentation/current-state updates required to record accepted behavior after implementation.

This task does **not** own:

- Production deployment/release logic;
- Cloudflare configuration or Access policies;
- credentials, Secrets, permissions, or repository-admin settings;
- branch-protection required-check configuration;
- Base/common CI internals;
- `#29`, `#31`, or `#9` feature behavior;
- CodeQL or broad static-analysis rollout;
- full dependency lock redesign or replacement of npm lockfile semantics.

## 8. Verification design

Before implementation:

- confirm `main` still matches the accepted/audited repository base or re-establish the new relevant base;
- confirm no equivalent hardening Issue/PR/configuration has appeared;
- resolve the exact immutable commit SHA for the selected dependency-review action release from current upstream evidence;
- verify the proposed Dependabot options against current GitHub syntax.

Implementation verification:

1. configuration review confirms Dependabot points only at root npm dependencies with the agreed weekly cadence, PR limit, and grouping policy;
2. dependency-review workflow is syntactically valid and uses immutable Action refs;
3. existing `npm test` and repository `verify` continue to pass;
4. no deployment/release command is executed;
5. no repository-admin setting is changed;
6. PR review confirms the new workflow does not duplicate existing CI work;
7. after merge, confirm GitHub accepts the Dependabot configuration and the dependency-review workflow is present on `main` without changing protected required checks.

No new string/YAML unit-test suite is required solely to assert configuration text. Add automated tests only if implementation introduces custom executable logic whose behavior warrants regression coverage.

## 9. Rollback

Rollback is a normal revert PR removing/reverting the repository-local Dependabot configuration and dependency-review workflow.

No shared-history rewrite, Production rollback, credential rotation, or administrator action should be necessary.

## 10. Acceptance criteria

- repository-local npm Dependabot version updates are configured with a low-noise weekly cadence;
- dependency-changing PRs receive distinct dependency-delta vulnerability review;
- newly introduced Actions are immutable-SHA pinned;
- existing CI remains the authoritative build/test verification path;
- CodeQL is not added in this pilot;
- no branch-protection, repository-admin, Secret, credential, release, deploy, or Cloudflare change occurs;
- existing feature Issues remain responsibility-separated;
- accepted behavior is recorded in the repository's Current State only after implementation is merged and verified.

## 11. Deferred decisions

The following remain separate future decisions:

- whether dependency review should ever become a protected required check;
- whether Dependabot security-update settings or alerts need repository-admin changes;
- whether GitHub Actions dependency updates should also be automated;
- whether Base/common workflows should adopt a cross-repository immutable-action policy;
- whether CodeQL or another code-scanning mechanism provides enough repository-specific signal to justify maintenance cost.

## 12. External reference points

Implementation must re-check the current official GitHub documentation rather than treating this design's 2026-09-26 platform assumptions as permanent. At design time, the relevant official references are:

- GitHub Docs: Configuring Dependabot version updates;
- GitHub Docs: Dependabot options reference;
- GitHub Docs: Dependency review;
- GitHub Docs: Configuring the dependency review action.
