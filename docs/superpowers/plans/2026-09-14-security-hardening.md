# Semantic Compression Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Harden the existing Semantic Compression Gateway against credential abuse and local secret commits while preserving its public API, Worker boundary, provider contract, and release architecture.

**Architecture:** Extend the existing route-policy middleware with ordered rate-limit stages. Compression will use a pre-auth IP limiter, the existing authenticated IP limiter, and a post-auth token-fingerprint limiter; only the Gateway consumes caller credentials. Reduce the Compression JSON body limit to the smallest tested MiB-level limit that admits every 200,000-code-point request, and document external verification items without changing provider behavior.

**Tech Stack:** Cloudflare Workers, Hono, Wrangler Rate Limit bindings, Node.js \`node:test\`, npm lockfile, GitHub Actions.

**Spec:** User-provided \`kinotch-api セキュリティ修正指示書\` in the current task.

## Global Constraints

- Keep \`POST /v1/compress\`, both profiles, the response contract, fixed model/prompts, \`store:false\`, Service Binding, provider retry policy, and rollback architecture unchanged.
- Keep \`GEMINI_API_KEY\` as the Cloudflare Worker secret and \`COMPRESSION_API_TOKEN\` as the Gateway caller secret; never expose either value.
- Keep authenticated Compression limiting at 5 requests / 60 seconds and fail closed when a configured limiter is unavailable.
- Do not rewrite history, remove tracked files, change \`src/text-core\`, change \`dev_agent\`, or alter unrelated routes.
- Do not implement \`max_output_tokens\`; investigate and report a proposal only.
- Do not change Cloudflare Dashboard or GitHub branch protection from repository code; report operator-only verification where unavailable.

---

### Task 1: Baseline and external-control audit

**Files:**
- Read: \`.gitignore\`, \`src/middleware/guard.js\`, \`src/middleware/rate-limit.js\`, \`src/middleware/authentication.js\`, \`src/policies/routes.js\`, both Wrangler configs, CI workflow, package manifests, relevant docs/tests.
- Modify: none.

**Interfaces:**
- Consumes: current \`origin/main\` and the audit requirements.
- Produces: source-state evidence, secret-like file check, observability/dependency findings, and official-source findings for Invocation Logs and Gemini output limits.

- [ ] Run \`git fetch origin\`, \`git status --short\`, \`git rev-parse HEAD\`, \`git rev-parse origin/main\`, and \`git branch --show-current\`; proceed only when clean and HEAD equals origin/main.
- [ ] Inspect current rate-limit ordering, policy bindings, body guard, authentication fingerprint calculation, Wrangler observability, CI actions, package graph, and documentation.
- [ ] Use official Cloudflare/Google sources or read-only authenticated checks for Invocation Logs and Gemini output limits. If unavailable, record \`operator verification required\`; do not infer a production fact.
- [ ] Verify that no current untracked or tracked secret-like filename exists without printing matching file contents.

### Task 2: TDD tests for ordered Compression rate limits

**Files:**
- Modify: \`test/compression-api.test.js\`.
- Test: \`test/compression-api.test.js\`.

**Interfaces:**
- Consumes: existing \`app.request()\` fixtures and fake Rate Limiter bindings.
- Produces: tests requiring pre-auth IP → authentication → authenticated IP → token fingerprint, preserving no downstream Authorization and fail-closed errors.

- [ ] Add policy assertions for \`preAuthRateLimit\`, existing \`rateLimit\` at 5/60, \`tokenRateLimit\`, and the ordered stages.
- [ ] Add a failing pre-auth test: a fake pre-auth limiter returns \`{ success: false }\`; assert 429, no auth-dependent limiter calls, no body/upstream read, and no raw token in output.
- [ ] Add a failing success-path test capturing the token limiter key; assert \`^semantic-compression-auth:[0-9a-f]{64}$\`, no fixture token, existing IP key remains \`^semantic-compression:\`, and downstream Authorization is null.
- [ ] Add failing fail-closed tests for missing/throwing pre-auth and token limiters; preserve the existing authenticated limiter failure test.
- [ ] Run \`npm test -- test/compression-api.test.js\`; confirm the new assertions fail because the current policy has no such stages.

### Task 3: Minimal ordered rate-limit implementation

**Files:**
- Modify: \`src/middleware/guard.js\`, \`src/middleware/rate-limit.js\`, \`src/middleware/authentication.js\`, \`src/policies/routes.js\`, \`wrangler.jsonc\`, \`test/compression-api.test.js\`.

**Interfaces:**
- Consumes: route policies with three Compression stages and a Hono context fingerprint.
- Produces: safe limiter keys, existing normalized error contracts, and no caller credential in the Service Binding request.

- [ ] Add distinct \`COMPRESSION_PREAUTH_RATE_LIMITER\` and \`COMPRESSION_TOKEN_RATE_LIMITER\` bindings using unique IDs consistent with the existing configuration; do not alter \`COMPRESSION_RATE_LIMITER\`.
- [ ] Generalize the existing rate-limit helper minimally so each configured stage receives a safe key resolver. Preserve error bodies, headers, fail-closed behavior, and observability.
- [ ] After successful constant-time auth comparison, store only a lowercase 64-character SHA-256 hex fingerprint in a Compression-specific context key; store nothing on failed auth.
- [ ] In \`policyMiddleware\`, execute pre-auth, auth, existing authenticated IP, token fingerprint, body, validation, then handler in that order. Do not affect policies without these fields.
- [ ] Run \`npm test -- test/compression-api.test.js\`; confirm the new and existing tests pass.
- [ ] Commit only this change with \`fix: harden compression rate limiting\`.

### Task 4: Secret hygiene and security documentation

**Files:**
- Modify: \`.gitignore\`, \`docs/semantic-compression.md\`, \`docs/specs/semantic-compression-api.md\`, \`docs/OPERATIONS.md\`, \`test/semantic-compression-docs.test.js\`.

**Interfaces:**
- Consumes: current secret setup/privacy docs.
- Produces: ignore rules, caller-token entropy guidance, three-stage limit documentation, and untrusted-output guidance.

- [ ] Add documentation tests for 256-bit cryptographic randomness, no human-created short password, pre-auth IP/authenticated IP/token-fingerprint limiting, and \`compressed_text\` as untrusted display data requiring sanitization before HTML rendering.
- [ ] Before implementation, verify \`git check-ignore -v .env.local .dev.vars private.pem caller.key\` does not yet match.
- [ ] Add exactly \`.env*\`, \`.dev.vars*\`, \`*.pem\`, and \`*.key\`; do not rewrite history or add a sample exception when no sample exists.
- [ ] Update operations/public-spec wording without changing API fields, fixed credentials, or Worker secret names.
- [ ] Run docs tests and \`git check-ignore -v .env.local .dev.vars private.pem caller.key\`.
- [ ] Commit with \`docs: harden compression secret handling\`.

### Task 5: Evidence-backed Compression body limit

**Files:**
- Modify: \`src/policies/routes.js\`, \`docs/API_PLAN.md\`, \`docs/semantic-compression.md\`, \`docs/specs/semantic-compression-api.md\`, \`test/compression-api.test.js\`.

**Interfaces:**
- Consumes: 200,000 Unicode code-point provider cap and the existing wire-byte body guard.
- Produces: a tested body limit that admits worst-case legal JSON input and reduces memory amplification.

- [ ] Add a failing boundary test measuring \`Buffer.byteLength(JSON.stringify({ text: "\\u0000".repeat(200_000), profile: "semantic-dense-v1" }), "utf8")\` and a four-byte Unicode case; assert both fit the chosen limit and one byte over is rejected before \`COMPRESSION.fetch\`.
- [ ] Run the focused test and record the exact measured sizes.
- [ ] Use 2 MiB unless an exact calculation proves 1 MiB admits every legal worst-case request with required structural margin; keep the 200,000-code-point provider cap unchanged.
- [ ] Update route policy, API plan, operations doc, public spec, and tests together, explicitly distinguishing wire bytes from Unicode code points.
- [ ] Run \`npm test -- test/compression-api.test.js\` and \`git diff --check\`; commit with \`fix: reduce compression request body limit\`.

### Task 6: Dependency and external-control hardening

**Files:**
- Modify: \`package.json\`, \`package-lock.json\` only if a safe non-major Wrangler update fixes sharp; \`.github/workflows/ci.yml\` only if official SHAs are verified; \`docs/OPERATIONS.md\` for findings/status.

**Interfaces:**
- Consumes: Wrangler 4.129.0 → miniflare → sharp 0.35.2 and read-only external control APIs.
- Produces: tested dependency update or documented dev-only hold; verified action pins or explicit retention; external-control status without Dashboard mutation.

- [ ] Re-run \`npm audit --omit=optional --json\`; if the fix remains a 4.x Wrangler update, install the reported fixed version and reject arbitrary sharp overrides.
- [ ] Verify \`npm ls sharp miniflare wrangler --all\`, \`npm test\`, text snapshot checks, and all three Wrangler dry-runs. Revert only the dependency change if behavior or dry-run regresses.
- [ ] Resolve \`actions/checkout@v4\` and \`actions/setup-node@v4\` to official repository commit SHAs via read-only GitHub API; pin only after verification.
- [ ] Read branch protection and recent checks if available; inspect Cloudflare auto-deploy/Invocation Logs only with read-only evidence. Mark inaccessible state as operator verification required.
- [ ] Keep P2-4 as investigation/report only: do not add max-output or truncation behavior.

### Task 7: Final verification, commit, push, and release decision

**Files:**
- Read: all changed files and release scripts.
- Modify: none unless a scoped verification regression requires correction.

**Interfaces:**
- Consumes: all isolated commits and available operator credentials.
- Produces: fresh evidence and an explicit production-deploy decision.

- [ ] Run \`npm test\`, \`git diff --check\`, \`git status --short\`, \`git diff origin/main...HEAD -- src/text-core\`, targeted secret-file checks, dependency listing, and all dry-runs.
- [ ] Confirm no secret values appear in repository files, logs, fixtures, or metadata.
- [ ] If rate-limit bindings/body limit change production behavior and Cloudflare access plus \`COMPRESSION_SMOKE_TOKEN\` are available, use only \`npm run deploy:production\`; never substitute an individual Worker deploy. Otherwise report production not run.
- [ ] After fresh verification, push \`main\` using the previously authorized normal flow and verify the GitHub \`test\` check for the pushed commit.
- [ ] Report residual operator-only controls and risks without claiming they are configured when they were not externally verified.

