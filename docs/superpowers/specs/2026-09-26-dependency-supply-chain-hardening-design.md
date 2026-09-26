# kinotch-api npm dependency supply-chain hardening design

Status: Design for review  
Date: 2026-09-26  
Owning Issue: #32  
Audit base: `3a46902db2ac51d7251cfd79dfb4660f191bc748`

## 1. Intent

`kinotch-api` is a shared Cloudflare API/MCP repository with a real npm dependency graph, a committed lockfile, Production release machinery, and repository-owned CI. The goal of this work is to add useful dependency supply-chain and reproducibility controls without turning generic security tooling into noisy mandatory ceremony or changing the Production contract.

Success means:

1. GitHub-hosted third-party Actions used by this repository are immutable at execution time.
2. npm dependency update proposals arrive at a deliberately low frequency rather than requiring manual discovery.
3. pull requests that actually change `package.json` or `package-lock.json` receive dependency-delta security review.
4. existing `npm test`, `knt verify`, Worker dry-runs, release logic, and `package-lock.json` remain the behavioral/reproducibility authorities they already are.
5. security-admin settings, Secrets, protected required-check configuration, release, deploy, and Cloudflare state remain outside this change.

This design does not attempt to make all dependency risk impossible. It establishes a bounded repository-local maintenance loop with clear ownership and evidence.

## 2. Current state and constraints

At the audit base:

- `package.json` has runtime dependencies on `@modelcontextprotocol/server`, `agents`, `hono`, `jose`, and `zod`, plus `json5` and `wrangler` as development dependencies.
- `package-lock.json` is lockfile version 3 and records exact resolved packages and integrity hashes.
- installation and CI use `npm ci`, so ordinary builds install the committed lock graph rather than freely resolving the semver ranges in `package.json`.
- `.github/workflows/ci.yml` already pins `actions/checkout` and `actions/setup-node` to immutable commit SHAs.
- `.github/workflows/verify.yml` still uses mutable `actions/checkout@v4`.
- the live `actions/checkout` `v4` ref currently resolves to `11d5960a326750d5838078e36cf38b85af677262`, which is already the SHA used by `ci.yml`.
- no repository-local Dependabot configuration or dependency-review workflow exists.
- Production deploy/release and credential boundaries are explicitly operator-managed and must not be altered by this work.

The committed npm lockfile means that converting every direct dependency range in `package.json` to an exact version is not required for deterministic ordinary installs. Dependency range policy and resolved dependency state have different responsibilities: `package.json` declares accepted package compatibility; `package-lock.json` plus `npm ci` owns the exact install graph.

## 3. Considered approaches

### A. Reproducibility pinning only

Pin the remaining mutable Action reference and add a regression invariant, but add no dependency automation.

Advantages:
- minimal change and minimal noise;
- closes the immediate mutable-Action gap.

Disadvantages:
- dependency freshness/security discovery remains manual;
- does not exercise the repository-specific supply-chain profile identified by devflow #100.

### B. Full security suite immediately

Add action pinning, Dependabot, dependency review, CodeQL, recurring audit jobs, and promote security checks to protected required status.

Advantages:
- broad coverage on paper.

Disadvantages:
- mixes distinct mechanisms and administrative boundaries;
- duplicates or competes with existing CI;
- likely produces low-signal checks and maintenance noise;
- makes failure attribution harder;
- violates the repository-specific/no-bulk principle from devflow #100.

### C. Layered repository-local pilot — selected

Add only three controls with separate responsibilities:

1. immutable external Action references;
2. low-frequency npm Dependabot version-update proposals;
3. dependency review only on PRs that change dependency manifests/lockfiles.

Defer CodeQL and any protected-required-check promotion until the pilot produces evidence that another control would add distinct signal.

This approach is selected because it addresses the known reproducibility gap and adds dependency-specific security evidence while keeping existing build/test CI authoritative.

## 4. Design

### 4.1 Reproducible GitHub Actions inputs

All external `uses:` references in repository-owned workflows must use a full 40-character commit SHA. A trailing release comment such as `# v4` may remain for human readability, but the SHA is the executable authority.

For the current `verify.yml`, use the same checkout commit already used by `ci.yml`:

`actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4`

A focused repository test should reject a future external Action ref that is a branch/tag rather than a full commit SHA. Local actions (`./...`) are outside this rule. The test exists to protect an actual security/reproducibility invariant; it should not become a generic YAML-style checker.

When a pinned Action is intentionally upgraded later, the upgrade PR must identify the upstream version/ref used to resolve the new SHA and rely on normal repository CI before merge.

### 4.2 npm resolution authority remains package-lock + npm ci

Do not exact-pin every range in `package.json` merely for uniformity. Keep the current npm model:

```text
package.json
  -> accepted direct dependency compatibility
package-lock.json
  -> exact resolved dependency graph + integrity
npm ci
  -> install exactly the committed lock graph
```

Dependency update PRs must update and review the lockfile normally. Existing tests, `knt verify`, and Worker dry-runs remain the authority for behavioral compatibility after a dependency change.

### 4.3 Low-noise Dependabot version updates

Add `.github/dependabot.yml` for npm at repository root.

Policy:

- cadence: monthly;
- open version-update PR limit: 2;
- minor/patch updates should be grouped where GitHub's supported Dependabot schema permits this without hiding which dependencies changed;
- major updates remain separately visible rather than being silently folded into a routine minor/patch group;
- Dependabot PRs must pass the same repository test/verify gates as human dependency changes;
- no automatic merge is granted merely because the author is Dependabot.

The purpose is discovery and proposal, not automatic acceptance. A dependency PR is still evaluated against repository contracts, Node 26 compatibility, Worker dry-runs, and any known upstream engine metadata constraints.

This configuration does not authorize repository-admin security settings. Enabling/disabling Dependabot security updates, vulnerability alerts, private registry credentials, or organization policy remains a separate administrative decision if not already available by repository defaults.

### 4.4 Dependency-delta review

Add a dedicated GitHub Actions workflow for pull requests that change either:

- `package.json`
- `package-lock.json`

The workflow should use GitHub's dependency review action pinned to an immutable full commit SHA selected and recorded during implementation.

The workflow's responsibility is narrow: identify the security/licensing risk delta introduced by dependency changes. It does not replace `npm test`, `knt verify`, install integrity, Worker dry-runs, or semantic code review.

Initial policy:

- trigger only on `pull_request` dependency-file changes;
- least-privilege permissions sufficient for read-only dependency review;
- no automatic comment/write capability unless a concrete need is demonstrated;
- do not make the workflow a protected required check during the pilot;
- if GitHub reports that dependency-review prerequisites are unavailable for the repository, fail closed in the owning Issue and do not silently enable repository-admin features.

The path-limited trigger is intentional. Ordinary source-only PRs should not run a dependency-delta check that has no dependency delta to inspect.

### 4.5 One-time baseline inspection, not a permanent noisy gate

During implementation verification, inspect the current lock graph once for known vulnerability signal using an ecosystem-appropriate read-only mechanism such as `npm audit --json` or equivalent GitHub dependency evidence. Record only actionable findings in the owning Issue; do not paste secrets or large raw audit payloads.

Do not add `npm audit` as an always-required CI gate by default. Registry/advisory availability and transitive advisory changes can create unrelated failures. The persistent controls from this pilot are the committed lockfile, immutable Action references, Dependabot proposals, and dependency-delta review.

Any current P0/P1 vulnerability discovered by the baseline inspection becomes a separate durable finding and blocks completion until dispositioned. Lower-severity findings are evaluated proportionally rather than automatically expanding scope.

## 5. Responsibility boundaries

This hardening work owns only dependency/reproducibility controls.

```text
kinotch-api #29
  -> Jev Remote history / rolling benchmark

kinotch-api #31
  -> Semantic Compression normal-chat/mobile bridge compatibility

kinotch-api #32
  -> npm dependency supply-chain / reproducibility pilot
```

No change from #32 may alter:

- public API/MCP request or response contracts;
- Worker bindings;
- provider/model behavior;
- release/deploy orchestration;
- Production Secrets;
- Cloudflare Access policy;
- machine-local Codex credential setup.

If implementation reveals a necessary change in one of those areas, stop and create/reuse the owning Issue rather than absorbing it into #32.

## 6. Verification strategy

Verification is proportional and layered.

### Reproducibility policy

Use a focused RED/GREEN regression test for immutable external Action refs:

1. RED against the current mutable `verify.yml` ref;
2. pin it to the exact accepted SHA;
3. GREEN on the focused test and full repository tests.

### Dependabot configuration

Validate the configuration structure and repository path/ecosystem assumptions without creating a redundant generic YAML test suite. GitHub's own Dependabot processing is the operational validation surface after merge.

### Dependency-review workflow

Verify:

- workflow syntax and immutable Action ref;
- path-limited dependency-file trigger;
- least-privilege permissions;
- existing repository CI remains unchanged and green.

A genuine dependency-changing PR, including a later Dependabot PR, is the authoritative live proof that the delta workflow executes against a real dependency change. Initial hardening acceptance does not require fabricating or merging a dependency version bump solely to make the workflow run.

### Existing behavior regression

Before merge, run the repository's existing authoritative verification, including the normal test/verify path and Worker dry-runs already owned by CI. No deployment or live Production smoke is required because this change does not modify deployed runtime code or release state.

### Review

The final implementation PR should receive an exact-head independent review because this repository is shared infrastructure and the change affects security/reproducibility controls.

## 7. Rollout and rollback

Implementation should be one bounded repository-local PR unless a blocking finding requires decomposition.

Recommended order:

1. add the focused immutable-Action regression and prove RED;
2. pin the remaining mutable Action ref and prove GREEN;
3. add low-noise Dependabot configuration;
4. add path-limited dependency-review workflow with immutable Action SHA;
5. perform one-time dependency baseline inspection;
6. run existing repository verification and independent review;
7. merge only if no blocking finding remains.

Rollback is a normal revert PR. No history rewrite, admin-setting rollback, Secret change, Cloudflare rollback, or Production deploy rollback should be necessary because none is part of this design.

## 8. Administrative and security boundary

The following remain explicit separate authorization boundaries and are not implied by approval of this design:

- changing branch protection / Rulesets;
- promoting dependency review or another security workflow to a protected required check;
- enabling or changing repository/organization security settings where admin authority is required;
- registering private-registry credentials or other Secrets;
- release or deploy;
- Cloudflare resource/access-policy mutation;
- credential/session rotation.

Repository file changes implementing this design remain normal reversible PR work. Any operation crossing the boundaries above must stop at `[USER_DECISION]`.

## 9. Acceptance criteria

The implementation is complete when:

- all repository-owned external GitHub Action references are immutable full SHAs;
- a focused regression prevents accidental return to mutable external Action refs;
- npm Dependabot version-update configuration is present with a low-noise monthly policy;
- dependency review is configured only for dependency-file PR changes and uses an immutable Action SHA;
- existing CI/test/verify behavior remains green;
- one-time baseline dependency inspection has no unresolved blocking P0/P1 finding, or any such finding has a separate durable disposition;
- no API/MCP/Production/release/deploy/credential/admin contract changed;
- final exact-head independent review has no blocking finding;
- repository Current State and devflow Control are updated only if their owned current facts changed.

## 10. Deferred decisions

The following are deliberately deferred until pilot evidence justifies them:

- CodeQL/code scanning;
- full transitive lock mechanisms beyond npm's existing lockfile;
- protected-required security checks;
- automated dependency PR merge;
- bulk adoption across other managed repositories;
- additional scheduled vulnerability scanning beyond the selected mechanisms.

These are not missing implementation tasks for #32. They require their own signal/risk justification.