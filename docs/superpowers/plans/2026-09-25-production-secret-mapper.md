# Production Secret Mapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed-path, fail-closed local secret mapper that launches the existing MCP smoke and Production release gates without exposing or copying secret values.

**Architecture:** `scripts/production-secret-mapper.mjs` will parse only `%USERPROFILE%\\.kinotch-secrets\\kinotch-api.production.env`, validate an allowlisted key set, construct a mode-specific environment from the existing release environment allowlist, and launch only the existing `npm run smoke:mcp` or `npm run deploy:production` command. It will contain no deploy, Cloudflare, smoke, or rollback logic of its own.

**Tech Stack:** Node 26 ESM, `node:util.parseEnv`, `node:fs/promises`, `node:child_process`, Node built-in test runner, existing `scripts/release-child-env.mjs`.

**Spec:** `C:\Users\kinok\.codex\attachments\3ce03b87-2067-40f3-be1f-2d19771e5d1e\貼り付けたテキスト.txt`

## Global Constraints

- Secret source is fixed to `%USERPROFILE%\\.kinotch-secrets\\kinotch-api.production.env`; no CLI path or alternate environment-variable path is accepted.
- Allowed file keys are exactly `TEAM_DOMAIN`, `POLICY_AUD`, `MCP_ENDPOINT`, `MCP_SMOKE_ACCESS_COOKIE`, and `COMPRESSION_SMOKE_TOKEN`.
- `mcp-smoke` maps only `MCP_ENDPOINT` and `MCP_SMOKE_ACCESS_COOKIE`.
- `production-release` maps all five allowed keys and launches only the existing `npm run deploy:production` authority.
- The mapper must never print secret values, the secret file contents, `process.env`, or a serialized mapped environment.
- Existing `smoke:mcp`, `deploy:production`, `deploy`, release gates, API contracts, Worker bindings, and rollback code remain unchanged.
- Tests use synthetic temporary inputs or injected dependencies and never read the real operator secret path.
- Cloudflare deploy credentials remain operator-managed outside this mapper file; they are not added to the five-key secret-file allowlist.

## Review Focus

- Fixed source boundary: a caller-supplied path or path-like argument must not alter the secret source; test `getProductionSecretPath` and the CLI mode parser.
- Unknown key fail-closed: a secret file containing an additional key must stop before a child process is started; test both the error and zero child invocations.
- Mode minimization: `mcp-smoke` must not receive release-only values and `production-release` must not receive arbitrary file keys; test exact mapped keys and values.
- Error privacy: missing-file, missing-key, parse, and unknown-mode errors may include safe names but never synthetic secret values; capture stdout/stderr and assert no value appears.
- Child failure propagation: the mapper must return the existing child exit status without replacing the release command or interpreting its output; test non-zero exit propagation with an injected child runner.

### Task 1: Secret parser and mode mapper

**Files:**
- Create: `test/production-secret-mapper.test.js`
- Create: `scripts/production-secret-mapper.mjs`

**Interfaces:**
- Produces `PRODUCTION_SECRET_RELATIVE_PATH`, `ALLOWED_PRODUCTION_SECRET_KEYS`, `MAPPER_MODES`, `getProductionSecretPath({ homeDirectory })`, `parseProductionSecretText(text)`, `loadProductionSecrets({ homeDirectory, readFileImpl })`, `requiredKeysForMode(mode)`, `mapProductionSecrets(secrets, mode)`, `createMappedChildEnv({ mode, sourceEnv, secrets })`, and `runMappedCommand(mode, options)`.
- `runMappedCommand` launches `npm run smoke:mcp` for `mcp-smoke` and `npm run deploy:production` for `production-release`, using an injected `spawnImpl` in tests and the existing release environment allowlist.

- [ ] **Step 1: Write failing mapper contract tests**

  Add tests for parsing all five allowed keys, fixed path construction, mode-specific mapping, missing file, missing required keys, unknown keys, unknown mode, no child start on validation failure, no secret values in captured mapper output, and child exit-code propagation. Use `mkdtemp` under the system temporary directory and dummy values such as `cookie-fixture-value`; never use the real `%USERPROFILE%\\.kinotch-secrets` path.

- [ ] **Step 2: Run the focused tests and verify the expected RED state**

  Run:

  ```powershell
  node --test test/production-secret-mapper.test.js
  ```

  Expected: FAIL because `scripts/production-secret-mapper.mjs` and its exported mapper interfaces do not exist yet.

- [ ] **Step 3: Implement the minimal parser and launcher**

  Use `parseEnv` inside a safe error boundary, reject unknown keys before mapping, validate required non-empty values by mode, derive the fixed path only from `os.homedir()`, and construct child environments by calling `createReleaseChildEnv` before overlaying only the mode's mapped keys. Use `spawn` with `stdio: "inherit"`, return the child exit code, and expose a `main` function that accepts only one of the two fixed modes.

- [ ] **Step 4: Run the focused tests and verify GREEN**

  Run:

  ```powershell
  node --test test/production-secret-mapper.test.js
  ```

  Expected: all mapper tests PASS, with no synthetic secret value in captured output.

- [ ] **Step 5: Commit the isolated mapper implementation**

  ```powershell
  git add scripts/production-secret-mapper.mjs test/production-secret-mapper.test.js
  git commit -m "feat: add production secret mapper"
  ```

### Task 2: Operator scripts and boundary documentation

**Files:**
- Modify: `package.json`
- Do not modify `AGENTS.md`; it is Base-managed and Verify rejects local edits. Record the same opaque boundary in the repository operator documentation instead.
- Modify: `README.md`
- Modify: `docs/USAGE.md`
- Modify: `docs/OPERATIONS.md`
- Test: `test/production-secret-mapper.test.js`

**Interfaces:**
- Consumes the mapper CLI modes from Task 1.
- Produces `npm run smoke:mcp:local` → `node scripts/production-secret-mapper.mjs mcp-smoke` and `npm run release:local` → `node scripts/production-secret-mapper.mjs production-release`.

- [ ] **Step 1: Add failing package and boundary assertions**

  Extend the mapper test to assert the exact package scripts, the fixed `%USERPROFILE%\\.kinotch-secrets\\` boundary, the two permitted commands, and that the documentation forbids direct secret-file inspection while allowing only the two mapper commands.

- [ ] **Step 2: Run the focused tests and verify RED**

  Run:

  ```powershell
  node --test test/production-secret-mapper.test.js
  ```

  Expected: FAIL because the package scripts and boundary documentation are not yet present.

- [ ] **Step 3: Add the two local-only package scripts**

  Add exactly:

  ```json
  "smoke:mcp:local": "node scripts/production-secret-mapper.mjs mcp-smoke",
  "release:local": "node scripts/production-secret-mapper.mjs production-release"
  ```

  Leave `smoke:mcp`, `deploy:production`, and `deploy` unchanged.

- [ ] **Step 4: Document the opaque operator boundary and usage**

  Add the required opaque Production Secret Boundary rules without naming or reading real secret values. Add concise README and detailed `docs/USAGE.md` / `docs/OPERATIONS.md` instructions covering the fixed file format, allowed keys, local commands, missing/unknown-key behavior, Cloudflare credential prerequisite, and the fact that `release:local` is only a launcher for `npm run deploy:production`.

- [ ] **Step 5: Run focused tests and verify GREEN**

  Run:

  ```powershell
  node --test test/production-secret-mapper.test.js
  ```

  Expected: all mapper, package-script, and documentation boundary tests PASS.

- [ ] **Step 6: Commit the operator surface**

  ```powershell
  git add package.json README.md docs/USAGE.md docs/OPERATIONS.md test/production-secret-mapper.test.js
  git commit -m "docs: expose production secret mapper workflow"
  ```

### Task 3: Current state, history, and regression verification

**Files:**
- Modify: `project/docs/CURRENT_STATE.md`
- Modify: `docs/DEVELOPMENT_HISTORY.md`
- Modify: `test/production-deploy-authority-docs.test.js`
- Modify: `test/operations-hardening.test.js`

**Interfaces:**
- Consumes the committed mapper and package scripts from Tasks 1–2.
- Produces repository evidence that the formal production authority remains `npm run deploy:production` and the mapper is not a second deploy path.

- [ ] **Step 1: Add failing current-state and history assertions**

  Assert that Current State and Operations identify the fixed external secret source, the two mapper commands, the opaque agent boundary, and the unchanged formal authority. Assert that Development History records the mapper purpose without containing a secret value.

- [ ] **Step 2: Run the targeted tests and verify RED**

  Run:

  ```powershell
  node --test test/production-deploy-authority-docs.test.js test/operations-hardening.test.js
  ```

  Expected: FAIL because the current-state and history entries are not yet present.

- [ ] **Step 3: Update only the relevant documentation**

  Add a Current State implemented item and a short history entry describing reduced repeated input, accidental agent access prevention, and preservation of the existing release gate. Do not record secret values, audience tags, cookie values, secret hashes, or operator-specific paths beyond the documented fixed `%USERPROFILE%` pattern.

- [ ] **Step 4: Run targeted tests and verify GREEN**

  Run:

  ```powershell
  node --test test/production-deploy-authority-docs.test.js test/operations-hardening.test.js
  ```

  Expected: all targeted documentation tests PASS.

- [ ] **Step 5: Run the repository verification suite**

  Run:

  ```powershell
  npm test
  git diff --check
  npm run check:text-snapshot
  npx wrangler deploy --config .\\wrangler.text-transform.jsonc --dry-run
  npx wrangler deploy --config .\\wrangler.semantic-compression.jsonc --dry-run
  npx wrangler deploy --config .\\wrangler.semantic-compression-mcp.jsonc --dry-run
  npx wrangler deploy --config .\\wrangler.jsonc --dry-run
  ```

  Expected: existing tests, snapshot checks, and all four Worker dry-runs pass; no production deploy is performed.

- [ ] **Step 6: Confirm no Text Core or secret-value diff and commit**

  Verify `git diff -- src/text-core` is empty and search only for the documented key names/placeholders, not real values. Then commit:

  ```powershell
  git add project/docs/CURRENT_STATE.md docs/DEVELOPMENT_HISTORY.md test/production-deploy-authority-docs.test.js test/operations-hardening.test.js
  git commit -m "docs: record production secret mapper boundary"
  ```

- [ ] **Step 7: Push and verify the remote revision**

  ```powershell
  git push origin main
  git rev-parse HEAD
  git ls-remote origin refs/heads/main
  ```

  Expected: the local HEAD and remote `main` SHA are identical. Do not run `npm run release:local`; this task adds the launcher but does not authorize a production release.

## Final Verification Checklist

- [ ] `npm run smoke:mcp:local` and `npm run release:local` exist and point only to the fixed mapper modes.
- [ ] The real operator secret file was never opened by tests or the agent.
- [ ] The mapper rejects alternate paths, unknown keys, missing keys, and unknown modes without printing values.
- [ ] The mapper passes only mode-required file keys plus the existing safe runtime/Cloudflare environment needed by the existing command.
- [ ] The formal production authority remains `npm run deploy:production`.
- [ ] `npm test`, `git diff --check`, snapshot checks, and four Worker dry-runs pass.
- [ ] `src/text-core` is unchanged.
- [ ] The final commit is pushed and remote SHA is verified.
