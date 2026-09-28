# Semantic Compression BYOK Local Self-Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight BYOK local REST path that lets a third party run the existing Semantic Compression Worker on loopback with only their own `GEMINI_API_KEY` in the repository-root `.env`.

**Architecture:** Reuse `src/semantic-compression-worker.js` and the existing Compression Core unchanged. Add a thin launcher that accepts only the root `.env`, parses and maps only `GEMINI_API_KEY`, rejects alternate Wrangler local-secret files, builds a bounded child environment, and starts a dedicated local Wrangler configuration in `--local` mode; keep Production Gateway, MCP, release, authentication, rate-limit, and Cloudflare-resource behavior untouched.

**Tech Stack:** Node.js `>=26.10.0 <27`, ES modules, Node built-in `parseEnv` and test runner, Wrangler `4.138.0`, existing Hono Semantic Compression Worker/Core.

**Spec:** `docs/superpowers/specs/2026-09-28-semantic-compression-byok-local-selfhost-design.md` (approved 2026-09-28)

## Global Constraints

- The only self-host secret is `GEMINI_API_KEY`.
- The only supported self-host secret file is the repository-root `.env`.
- The launcher must reject a root `.dev.vars` or any root `.dev.vars.*` before spawning Wrangler so no alternate Wrangler local-secret source can bypass or shadow the `.env` allowlist boundary.
- The supported endpoint is loopback-only at `127.0.0.1:8787`; public/shared-network hosting is outside this feature.
- Reuse `src/semantic-compression-worker.js`; do not fork or duplicate profiles, prompt text/version, model choice, limits, response schema, integrity warnings, or provider logic.
- Do not add a dotenv/runtime dependency; use Node built-ins already available in Node 26.
- Do not change Production Wrangler files, Gateway auth/rate limits, Production secret mapping, deploy/release commands, MCP behavior, or Cloudflare resources.
- `selfhost:compression` must never invoke `deploy`, `--remote`, authentication setup, or resource mutation.
- The launcher accepts no user arguments and must fail closed instead of forwarding Wrangler flags.
- The launcher child environment starts from `createReleaseChildEnv(sourceEnv)`, adds only `GEMINI_API_KEY` plus the fixed launcher-control variable `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false`, and does not forward Cloudflare deployment credentials or unrelated source environment variables.
- The dedicated Wrangler config declares only `GEMINI_API_KEY` in `secrets.required` and contains no KiNoTch. account/resource IDs or Production hostnames.
- Ordinary automated tests must not call Gemini.
- A live Gemini E2E is evidence only when an operator-owned key is locally available; absence of that key keeps Issue #23 open rather than fabricating completion evidence.

## Review Focus

1. `.env` contains unrelated or Cloudflare-looking keys: only `GEMINI_API_KEY` reaches the child Worker environment.
2. Wrangler cannot bypass the launcher allowlist through either automatic `.env` reloading or an alternate `.dev.vars` / `.dev.vars.*` file: auto `.env` loading is disabled and alternate local-secret files are rejected before spawn.
3. Missing, malformed, empty, quoted, and whitespace-containing dotenv values follow Node `parseEnv` semantics and fail safely when the required key is unusable.
4. Any launcher argument such as `--remote`, `deploy`, another config path, or another port is rejected before process spawn.
5. Spawn failure or non-zero child exit preserves a safe diagnostic/exit result without revealing the Gemini key or widening the environment.

---

### Task 1: Implement the bounded self-host launcher

**Files:**
- Create: `scripts/selfhost-compression.mjs`
- Create: `test/selfhost-compression.test.js`

**Interfaces:**
- Consumes: repository-root `.env`, `createReleaseChildEnv(sourceEnv)` from `scripts/release-child-env.mjs`, and `createWranglerInvocation(args, { projectRoot })` from `scripts/wrangler-runner.mjs`.
- Produces:
  - `SELFHOST_ENV_FILENAME = ".env"`
  - `SELFHOST_SECRET_KEYS = Object.freeze(["GEMINI_API_KEY"])`
  - `parseSelfHostEnv(sourceText)` -> frozen `{ GEMINI_API_KEY }` or throws a safe configuration error.
  - `loadSelfHostSecrets({ projectRoot, readFileImpl, readdirImpl })` -> rejects root `.dev.vars` / `.dev.vars.*`, then returns frozen `{ GEMINI_API_KEY }` from root `.env`.
  - `createSelfHostChildEnv({ sourceEnv, secrets })` -> safe child environment.
  - `resolveSelfHostInvocation({ projectRoot })` -> fixed local Wrangler invocation.
  - `runSelfHostCommand({ secrets, sourceEnv, spawnImpl, projectRoot })` -> child exit code.
  - `main(argv = process.argv.slice(2), deps = {})` -> process exit code; `argv.length` must be exactly `0`.

- [ ] **Step 1: Write the failing launcher tests**

  In `test/selfhost-compression.test.js`, add tests with these assertions:

  - `parseSelfHostEnv("GEMINI_API_KEY=fixture\nUNRELATED_SECRET=ignored")` returns exactly `{ GEMINI_API_KEY: "fixture" }`.
  - malformed dotenv input throws `Could not parse self-host .env` and never includes source values.
  - missing `.env`, missing `GEMINI_API_KEY`, and empty `GEMINI_API_KEY` fail before spawn with short setup errors that do not include a secret value.
  - quoted and whitespace-containing legal dotenv values are accepted according to Node `parseEnv` rather than by a custom parser.
  - a synthetic root listing containing `.dev.vars` or `.dev.vars.local` causes `loadSelfHostSecrets` to fail before reading/spawning the local server, even when `.env` itself is valid; the error directs the user to use root `.env` only and contains no secret value.
  - `createSelfHostChildEnv` preserves ordinary safe variables such as `PATH`, maps the Gemini key, sets `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV` to `false`, and omits `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL`, `WRANGLER_API_TOKEN`, and unrelated source variables.
  - `resolveSelfHostInvocation` uses the local installed Wrangler through `createWranglerInvocation` and the exact Wrangler argument list `dev --local --config wrangler.semantic-compression.selfhost.jsonc`; it contains neither an effective `deploy` command nor `--remote`.
  - `main(["--remote"])` and any other non-empty argument list fail before spawn.
  - a synthetic Gemini key never appears in captured stdout/stderr.
  - child exit code `17` is returned as `17`; synchronous spawn failure returns a safe non-zero result.

- [ ] **Step 2: Run the focused tests and verify RED**

  Run: `node --test test/selfhost-compression.test.js`

  Expected: FAIL because `scripts/selfhost-compression.mjs` does not exist.

- [ ] **Step 3: Implement the minimal launcher**

  Use `readFile`, `readdir`, `fileURLToPath`, `join`, `parseEnv`, `spawn`, `createReleaseChildEnv`, and `createWranglerInvocation`. Do not introduce a new generic mapper abstraction.

  Required behavior:

  - fixed repository-root `.env` only; no alternate path argument;
  - inspect the repository root and fail closed if an entry equals `.dev.vars` or starts with `.dev.vars.`;
  - allowlist only `GEMINI_API_KEY` from parsed `.env`;
  - reject absent/malformed/empty required key before spawn;
  - `createReleaseChildEnv(sourceEnv)` is the child-environment baseline;
  - add `GEMINI_API_KEY` and fixed `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV="false"` only;
  - spawn the fixed local Wrangler invocation with `{ cwd: projectRoot, env: childEnv, stdio: "inherit", shell: false }`;
  - never print secret contents.

- [ ] **Step 4: Run the focused tests and verify GREEN**

  Run: `node --test test/selfhost-compression.test.js`

  Expected: PASS for parser, alternate-secret-source rejection, allowlist, invocation, argument rejection, secret-redaction, and exit-propagation cases.

- [ ] **Step 5: Commit the launcher boundary**

  ```bash
  git add scripts/selfhost-compression.mjs test/selfhost-compression.test.js
  git commit -m "feat: add bounded compression self-host launcher"
  ```

### Task 2: Add the self-host Wrangler config, npm entry point, and `.env.example`

**Files:**
- Create: `.env.example`
- Create: `wrangler.semantic-compression.selfhost.jsonc`
- Create: `test/selfhost-compression-config.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `scripts/selfhost-compression.mjs` from Task 1 and existing `src/semantic-compression-worker.js`.
- Produces: `npm run selfhost:compression` and a dedicated local-only Wrangler configuration.

- [ ] **Step 1: Write the failing configuration tests**

  Parse the JSONC with the existing `json5` dev dependency and assert:

  - `main === "src/semantic-compression-worker.js"`;
  - `name === "semantic-compression-selfhost"`;
  - `compatibility_date === "2026-09-07"`;
  - `workers_dev === false` and `preview_urls === false`;
  - `secrets.required` is exactly `["GEMINI_API_KEY"]`;
  - `dev` is exactly compatible with loopback `ip: "127.0.0.1"`, `port: 8787`, `local_protocol: "http"`;
  - non-secret vars are `ENABLE_REQUEST_LOGS: "false"` and `GEMINI_TIMEOUT_MS: "45000"`;
  - config does not define `account_id`, `routes`, `services`, `ratelimits`, `kv_namespaces`, Production hostname values, or Access configuration;
  - `package.json.scripts["selfhost:compression"] === "node scripts/selfhost-compression.mjs"`;
  - `.env.example` defines `GEMINI_API_KEY=` with no credential-looking value and no second secret variable;
  - `.gitignore` still ignores `.env`/`.env.*` while allowing `.env.example`;
  - package dependency sets are unchanged except for the new script; no dotenv package appears and `package-lock.json` needs no dependency change.

- [ ] **Step 2: Run the focused tests and verify RED**

  Run: `node --test test/selfhost-compression-config.test.js`

  Expected: FAIL because the new config/example/script entry do not yet exist.

- [ ] **Step 3: Add the minimal config and entry point**

  Create `wrangler.semantic-compression.selfhost.jsonc` with only the approved local fields. Add `.env.example` with comments plus an empty `GEMINI_API_KEY=` placeholder. Add the package script only; do not modify existing deploy/dev/release scripts.

- [ ] **Step 4: Run focused and launcher tests**

  Run:

  ```bash
  node --test test/selfhost-compression-config.test.js test/selfhost-compression.test.js
  ```

  Expected: PASS.

- [ ] **Step 5: Run the full normal suite**

  Run: `npm test`

  Expected: all ordinary tests pass with no external Gemini request.

- [ ] **Step 6: Commit the local surface**

  ```bash
  git add .env.example wrangler.semantic-compression.selfhost.jsonc package.json test/selfhost-compression-config.test.js
  git commit -m "feat: add BYOK local compression surface"
  ```

### Task 3: Document and canonize the lightweight self-host contract

**Files:**
- Create: `docs/semantic-compression-selfhost.md`
- Modify: `docs/specs/semantic-compression-api.md`
- Modify: `project/docs/INDEX.md`
- Modify: `test/semantic-compression-docs.test.js`
- Modify at final accepted-state reconciliation only: `project/docs/CURRENT_STATE.md`

**Interfaces:**
- Consumes: the Task 1 launcher and Task 2 local config.
- Produces: a user guide and durable specification that distinguish local BYOK from KiNoTch. Production.

- [ ] **Step 1: Add failing documentation-contract assertions**

  Extend `test/semantic-compression-docs.test.js` to include `docs/semantic-compression-selfhost.md` and require:

  - `npm run selfhost:compression`;
  - `.env.example` and `GEMINI_API_KEY`;
  - an explicit root `.env`-only rule and a statement that `.dev.vars` / `.dev.vars.*` are not supported by this launcher;
  - `127.0.0.1:8787`;
  - `POST /v1/compress` and `GET /health`;
  - explicit statements that local mode has no Production Gateway Bearer auth/rate limit and must not be exposed directly to the public internet;
  - no real secret-looking value, KiNoTch. Cloudflare account ID, Service Token value, or Production credential in the guide.

- [ ] **Step 2: Run the docs test and verify RED**

  Run: `node --test test/semantic-compression-docs.test.js`

  Expected: FAIL because the self-host guide/spec section do not yet exist.

- [ ] **Step 3: Write the self-host guide**

  `docs/semantic-compression-selfhost.md` must contain only the supported path:

  1. clone / `npm ci`;
  2. ensure no root `.dev.vars` / `.dev.vars.*` is present for this self-host mode;
  3. copy `.env.example` to `.env`;
  4. set the user's own `GEMINI_API_KEY`;
  5. `npm run selfhost:compression`;
  6. `GET http://127.0.0.1:8787/health`;
  7. sample `POST http://127.0.0.1:8787/v1/compress` for both existing profiles;
  8. explain that response/profile/prompt/model/integrity behavior comes from the existing Compression Core;
  9. explain loopback/public-security boundary and that MCP/full Cloudflare installation are non-goals;
  10. troubleshooting for absent/malformed/empty `.env` and conflicting `.dev.vars*`, without suggesting alternate secret paths.

- [ ] **Step 4: Update the durable API specification and index**

  Add a local self-host section to `docs/specs/semantic-compression-api.md` without redefining core profile/provider behavior. Use unique requirement identifiers such as:

  - `ARCH-COMP-SELFHOST-001` — local BYOK path delegates directly to the existing Worker/Core on loopback;
  - `SEC-COMP-SELFHOST-001` — root `.env` allowlist boundary, one required secret, rejection of `.dev.vars*`, no Production credentials, no public security claim;
  - `BEH-COMP-SELFHOST-001` — fixed `npm run selfhost:compression`, fail-fast setup errors, no arbitrary launcher args, no deploy/remote path.

  Add `docs/semantic-compression-selfhost.md` to `project/docs/INDEX.md`.

- [ ] **Step 5: Run docs and full regression tests**

  Run:

  ```bash
  node --test test/semantic-compression-docs.test.js
  npm test
  ```

  Expected: PASS; no external request.

- [ ] **Step 6: Commit docs/spec changes**

  ```bash
  git add docs/semantic-compression-selfhost.md docs/specs/semantic-compression-api.md project/docs/INDEX.md test/semantic-compression-docs.test.js
  git commit -m "docs: specify BYOK local compression self-hosting"
  ```

### Task 4: Verify the real entry point, review, merge, and reconcile Issue #23

**Files:**
- Verify: all Task 1-3 files plus existing Compression/Production regression scope.
- Modify after accepted merge: `project/docs/CURRENT_STATE.md` and Issue/control records as required by repository governance.

**Interfaces:**
- Consumes: complete branch implementation.
- Produces: machine-verifiable local smoke evidence, PR/CI/review evidence, and accepted repository state. No Production deployment is part of this task.

- [ ] **Step 1: Run focused and full automated verification**

  Run:

  ```bash
  node --test test/selfhost-compression.test.js test/selfhost-compression-config.test.js test/semantic-compression-docs.test.js
  npm test
  ```

  Expected: all pass; ordinary tests make no Gemini request.

- [ ] **Step 2: Run repository verification**

  Run the repository-supported verify entry point (`knt.cmd verify` on Windows or the equivalent `.kinotch` verify command for the active shell).

  Expected: PASS, including existing Production/release/config regression checks.

- [ ] **Step 3: Verify Production isolation from the diff**

  Confirm the implementation does not modify Production Wrangler files, Production deploy/release scripts, Gateway auth/rate-limit implementation, MCP implementation, or Compression Core behavior. Confirm the effective self-host config/launcher contains no `account_id`, Production hostname, Service Token value, Cloudflare API credential, remote execution mode, or deploy action. Tests/docs may mention forbidden strings such as `--remote` only to prove or explain rejection.

- [ ] **Step 4: Run loopback health smoke without external Gemini traffic**

  Use a temporary local `.env` containing a non-empty synthetic `GEMINI_API_KEY`, ensure no root `.dev.vars*` exists, start `npm run selfhost:compression`, then request `GET http://127.0.0.1:8787/health`.

  Expected: HTTP 200 with the existing `semantic-compression` health payload; server listens only on loopback. Stop the child and remove the temporary `.env` after the check.

- [ ] **Step 5: Run one real BYOK compression E2E when an operator-owned Gemini key is available**

  With a locally supplied user-owned `GEMINI_API_KEY` in the supported root `.env`, start the same `npm run selfhost:compression` path and send one synthetic `POST /v1/compress` using `semantic-dense-v1`.

  Expected: HTTP 200; returned `profile`, `prompt_version`, and `model` equal the current reused Core contract; key is absent from terminal output, repository diff, generated artifacts, and logs; no Cloudflare login, resource creation, deploy, or Production mutation occurs.

  If no authorized local key is available, record this exact acceptance item as pending and keep Issue #23 open. Do not substitute the existing direct `test:compression:live` path for this launcher E2E.

- [ ] **Step 6: Open the implementation PR and obtain exact-head review/CI**

  PR must reference Issue #23 and the approved design/plan, state that there is no deploy/release, list automated and real-entry evidence, and note any pending live E2E. Required `test` and `verify` checks must pass. Perform formal review against the exact PR head according to repository review rules.

- [ ] **Step 7: Merge only when acceptance is satisfied**

  Merge is allowed as a low-risk/revertible repository change after required checks/review and Task 4 acceptance are complete. Do not run a Production release/deploy.

- [ ] **Step 8: Reconcile accepted Current State and Issue/control records**

  After merge, update `project/docs/CURRENT_STATE.md` so it records the accepted main SHA and the lightweight BYOK local REST capability without converting Current State into a task log. If this requires a separate small docs PR under repository rules, use that path.

  Then update Issue #23 with the final accepted evidence and close it as completed only when all lightweight-scope acceptance criteria, including the real launcher E2E, are satisfied. Update `devflow#18` to the accepted main SHA and return it to the appropriate WAIT state with #9 as the remaining independent gate.

  If the live BYOK E2E remains unavailable, leave #23 open/WAITING and record the exact missing evidence rather than closing it.
