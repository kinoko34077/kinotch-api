# Production Deploy Authority Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm run deploy:production` the sole documented production release authority, prepare the required GitHub and Cloudflare operator settings, and verify that existing compression/text implementation remains unchanged.

**Architecture:** Keep the existing release script, Workers, Service Bindings, smoke, and rollback logic unchanged. Record the external-control-plane requirements in the operations source of truth, add a small documentation contract test, and apply GitHub branch protection plus Cloudflare Workers Builds disconnection only through their authenticated control planes.

**Tech Stack:** Node.js test runner, Markdown operations documentation, GitHub repository settings, Cloudflare Workers Builds dashboard.

**Spec:** User-provided `kinotch-api 残修正指示書` (2026-09-13)

## Global Constraints

- Scope is limited to Cloudflare automatic Production deploy path, `main` branch protection, and the corresponding operations documentation.
- Production authority is exactly `npm run deploy:production`.
- `main` requires the GitHub Actions check named `test`; force pushes and branch deletion remain disabled.
- Cloudflare Workers Builds/Git integration must not independently deploy Production from `main`.
- Do not modify Compression API contract, prompt, Gemini adapter, context limit, smoke generation count, rollback logic, Service Binding, auth, rate limit, or Text Core.
- Do not run a production deploy or any destructive production smoke.
- API keys and tokens must not be written to source, docs, tests, logs, or release metadata.

---

### Task 1: Record the external-control-plane requirements

**Files:**
- Create: `docs/superpowers/plans/2026-09-13-production-deploy-authority-hardening.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `README.md`
- Modify: `docs/API_PLAN.md`
- Test: `test/production-deploy-authority-docs.test.js`

**Interfaces:**
- Consumes: Existing `npm run deploy:production` script and `.github/workflows/ci.yml` job id `test`.
- Produces: One operations source of truth that explicitly describes the only production authority and external operator settings.

- [ ] **Step 1: Write the documentation contract test**

  Assert that `docs/OPERATIONS.md` contains the exact authority command, states that `main` push does not directly deploy production, states that Cloudflare Workers Builds auto-deploy is disabled, names required check `test`, and states force-push/deletion prohibition.

- [ ] **Step 2: Run the focused test and verify the missing policy fails**

  Run: `node --test test/production-deploy-authority-docs.test.js`

  Expected: FAIL until the operations policy is added.

- [ ] **Step 3: Add the single operations policy and concise README/API plan pointers**

  Keep `docs/OPERATIONS.md` authoritative. State that Cloudflare Dashboard and GitHub settings are operator-managed, and do not claim they are already applied until read-back evidence confirms them. Make `README.md` and `docs/API_PLAN.md` point to that source without duplicating the release sequence.

- [ ] **Step 4: Run the focused test and verify it passes**

  Run: `node --test test/production-deploy-authority-docs.test.js`

  Expected: PASS.

- [ ] **Step 5: Commit the repo-only hardening**

  Run: `git add docs/OPERATIONS.md README.md docs/API_PLAN.md test/production-deploy-authority-docs.test.js docs/superpowers/plans/2026-09-13-production-deploy-authority-hardening.md && git commit -m "docs: define production deploy authority"`

### Task 2: Apply GitHub main protection

**Files:**
- External: `https://github.com/kinoko34077/kinotch-api/settings/branches`

**Interfaces:**
- Consumes: Existing GitHub Actions job name `test` from `.github/workflows/ci.yml`.
- Produces: `main` branch protection with required check `test`, force push disabled, and deletion disabled. PR requirement remains unset unless the user explicitly elects it.

- [ ] **Step 1: Open the branch protection form and select `main`**

  Use the authenticated GitHub settings UI. Select the classic branch protection form or equivalent ruleset that can express the required minimum without adding unrelated restrictions.

- [ ] **Step 2: Configure only the minimum required settings**

  Enable required status checks and add exact check name `test`. Leave “allow force pushes” and “allow deletions” disabled. Leave pull-request requirement disabled for this initial hardening because it is optional in the request.

- [ ] **Step 3: Save the rule and read back the resulting state**

  Confirm that `main` is protected, `test` is required, force pushes are not allowed, and deletion is not allowed. Record the GitHub settings URL and read-back result in the final report.

### Task 3: Disable Cloudflare Workers Builds auto Production deploy

**Files:**
- External: Cloudflare Workers & Pages `api` → Settings → Builds

**Interfaces:**
- Consumes: Existing `api` Git integration currently connected to `kinoko34077/kinotch-api` with production branch `main` and deploy command `npx wrangler deploy`.
- Produces: The Git integration is disconnected so a `main` push cannot independently deploy Cloudflare Production. The manual `npm run deploy:production` release gate remains the only documented authority.

- [ ] **Step 1: Verify the current connected repository and production branch**

  Confirm the dashboard still shows the `kinoko34077/kinotch-api` repository, production branch `main`, and an independent deploy command before changing it.

- [ ] **Step 2: Disconnect the Git repository from Workers Builds**

  Use the Cloudflare dashboard’s disconnect action for the `api` Worker. Do not manually deploy any Worker as part of this change.

- [ ] **Step 3: Read back the Builds settings**

  Confirm that no Git repository/production branch remains connected for automatic production deployment. Record the dashboard result in the final report.

### Task 4: Run repository verification and push the repo change

**Files:**
- Verify only; no further implementation files.

**Interfaces:**
- Consumes: The committed documentation policy and existing release implementation.
- Produces: Fresh test, whitespace, diff-scope, GitHub, and Cloudflare evidence.

- [ ] **Step 1: Run the complete repository test suite**

  Run: `npm test`

  Expected: Existing tests pass, with only the intentional live-provider skip if the credential is absent.

- [ ] **Step 2: Verify whitespace and protected implementation scope**

  Run: `git diff --check` and `git diff HEAD^ -- src/compression src/text-core scripts/deploy-production.mjs scripts/smoke-production.mjs`.

  Expected: whitespace check passes and the protected implementation diff is empty for this documentation/settings change.

- [ ] **Step 3: Push the committed repo change after verification**

  Run: `git push origin main`

  Expected: `origin/main` advances only with the documentation/test commit; no production deployment is initiated by repo code.

- [ ] **Step 4: Re-read final external settings and repository state**

  Confirm GitHub branch protection and Cloudflare disconnected status after the push, then report any remaining operator work instead of inferring it.
