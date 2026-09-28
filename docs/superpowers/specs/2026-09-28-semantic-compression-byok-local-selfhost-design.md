# Semantic Compression BYOK Local Self-Host Design

**Date:** 2026-09-28

**Status:** Approved 2026-09-28; implementation follows `docs/superpowers/plans/2026-09-28-semantic-compression-byok-local-selfhost.md`.

**Owning Issue:** #23

## 1. Goal

Provide a lightweight third-party usage path for Semantic Compression that balances implementation cost against usability.

A user who clones `kinotch-api` should be able to supply only their own Gemini API key in a local `.env` file and start the existing Semantic Compression REST worker locally with one npm command.

Target experience:

```text
git clone <repo>
cd kinotch-api
npm ci
copy .env.example .env
# set GEMINI_API_KEY in .env
npm run selfhost:compression
```

The resulting local endpoint exposes the existing Semantic Compression Worker contract at:

```text
http://127.0.0.1:8787/v1/compress
```

This design does not create a new compression implementation and does not attempt to reproduce the full KiNoTch. Production Cloudflare topology.

## 2. Design decision

The supported lightweight self-host boundary is **BYOK local REST**, not a generic Cloudflare installer.

```text
user-owned .env
  GEMINI_API_KEY=<user key>
        |
        v
thin allowlist launcher
        |
        v
self-host-only Wrangler local config
        |
        v
existing src/semantic-compression-worker.js
        |
        +-- existing request validation
        +-- existing profile resolution
        +-- existing prompt source of truth
        +-- existing Gemini provider adapter
        +-- existing integrity warnings
        +-- existing response contract
        |
        v
Google Gemini Interactions API
```

The changing user-owned value is the Gemini key. Compression behavior remains owned by the existing core and current API specification.

## 3. Existing implementation reused unchanged

The self-host path must reuse the current implementation rather than duplicate it.

Canonical behavior remains owned by:

- `docs/specs/semantic-compression-api.md`
- `src/semantic-compression-worker.js`
- `src/semantic-compression/contract.js`
- `src/semantic-compression/prompt.js`
- `src/semantic-compression/prompt-metadata.js`
- `src/semantic-compression/gemini.js`
- `src/semantic-compression/integrity.js`

The self-host layer must not maintain its own copies of supported profiles, prompt text/versions, model selection, input limits, response schema, integrity-warning rules, or provider request semantics.

If those canonical definitions change, the local self-host path receives the new behavior through the reused Worker/Core automatically.

## 4. User configuration and secret contract

### 4.1 Required user input

Exactly one self-host secret is required for the initial supported path:

```text
GEMINI_API_KEY
```

The repository provides a committed `.env.example` containing the variable name and setup comments but never a credential value. The user copies it to `.env` and inserts their own key.

The existing repository ignore rules already exclude `.env` and permit `.env.example`.

### 4.2 Selected secret boundary

The launcher is required rather than relying only on Wrangler's missing-secret warning.

It must:

1. read the root `.env` using the Node runtime already required by the repository;
2. parse dotenv syntax with built-in Node capability rather than adding a dotenv package;
3. extract only `GEMINI_API_KEY`;
4. fail before server startup when the file is absent, malformed, or the key is absent/empty;
5. never print the key;
6. ignore unrelated `.env` keys rather than forwarding them;
7. start Wrangler with a bounded child environment that contains only ordinary safe process variables plus `GEMINI_API_KEY` and launcher-control variables;
8. exclude Cloudflare credential environment variables from that child environment;
9. disable Wrangler's independent `.env` re-loading for that child process so the launcher's allowlist remains the effective secret boundary;
10. reject root `.dev.vars` / `.dev.vars.*` so no alternate Wrangler local-secret file can shadow the supported root `.env` source.

The self-host path must not read `%USERPROFILE%\.kinotch-secrets\kinotch-api.production.env` and must not require `COMPRESSION_API_TOKEN`, Cloudflare Access credentials, Service Tokens, or Cloudflare deployment credentials.

Current Wrangler supports `.env` / `.dev.vars` local secret loading and `secrets.required`; the dedicated self-host config still declares only `GEMINI_API_KEY` as required. The launcher exists to add fail-fast validation and a strict mapping boundary, not to create a second configuration framework.

## 5. Dedicated self-host configuration

Add a self-host-only Wrangler configuration separate from Production configuration:

```text
wrangler.semantic-compression.selfhost.jsonc
```

It contains only what local execution requires:

- `main: src/semantic-compression-worker.js`;
- a distinct local Worker name;
- the repository-compatible `compatibility_date`;
- `secrets.required = ["GEMINI_API_KEY"]`;
- safe non-secret runtime vars already required by the Worker, such as timeout/log switches;
- local dev binding to `127.0.0.1` and port `8787`.

It must not contain KiNoTch. `account_id`, Production routes, Production Service Bindings, Production rate-limit namespace IDs, Cloudflare Access configuration, Production KV IDs, Production hostnames, or Production credentials.

The launch command uses Wrangler local execution explicitly and the dedicated self-host config. It never uses `--remote` and never routes through a deploy/release command.

## 6. Launcher boundary

Expose one user-facing command:

```text
npm run selfhost:compression
```

A small `scripts/selfhost-compression.mjs` owns the boundary. Its responsibilities are limited to:

1. `.env` preflight and allowlisted key extraction;
2. rejection of alternate root `.dev.vars*` secret sources;
3. sanitized child-environment construction;
4. starting a fixed `wrangler dev --local --config wrangler.semantic-compression.selfhost.jsonc` invocation;
5. preserving Wrangler's exit status and normal local-server output;
6. rejecting launcher arguments rather than forwarding arbitrary Wrangler flags;
7. never invoking `wrangler deploy`, Production release scripts, authentication setup, or Cloudflare resource mutation.

The launcher must not become a general environment mapper, installer, deployment manager, provider router, or configuration framework.

No new runtime dependency is introduced for this launcher.

## 7. Local REST contract

The local path reuses the Worker-level REST surface:

```text
POST /v1/compress
Content-Type: application/json
```

Example:

```json
{
  "text": "compression input",
  "profile": "semantic-dense-v1"
}
```

Supported profiles, prompt versions, model, limits, response fields and warning behavior are inherited from the current Semantic Compression API/Core specification rather than redefined here.

The local path also retains:

```text
GET /health
```

### Difference from KiNoTch. Production Gateway

This lightweight local path does **not** reproduce the public Gateway boundary and therefore does not provide its Bearer `COMPRESSION_API_TOKEN` authentication, Gateway rate limits, Service Binding topology, or public-internet hardening.

That difference is acceptable only because the supported endpoint is loopback-local and is not presented as a public deployment recipe.

## 8. Network and safety boundary

The supported server binds to loopback only:

```text
127.0.0.1:8787
```

Documentation must explicitly state that the local endpoint is not an internet-facing server product. Tunnels, reverse proxies, `0.0.0.0`, shared-network exposure, containers/public hosts, and Cloudflare deployment are outside this feature's supported security boundary unless separately designed with authentication and abuse controls.

## 9. Production isolation

The self-host feature is additive and must not change KiNoTch. Production behavior.

Implementation acceptance requires that:

- existing Production Wrangler files remain authoritative for Production;
- existing Production secret mapper behavior is unchanged;
- existing release/deploy commands are unchanged;
- existing Gateway authentication/rate-limit behavior is unchanged;
- existing MCP behavior is unchanged;
- `selfhost:compression` has no Cloudflare deployment credential in its child environment;
- no Cloudflare resource is created or mutated by `selfhost:compression`;
- no Production deploy is performed as part of this work.

## 10. Non-goals

The following are explicitly outside Issue #23's lightweight completion scope:

- zero-edit deployment to another Cloudflare account;
- creation of rate-limit namespaces;
- Cloudflare Access application setup;
- Service Token or Managed OAuth setup;
- self-host MCP;
- public REST hosting;
- Docker packaging;
- GUI installer;
- multi-provider support;
- arbitrary model/prompt selection;
- generic LLM proxy behavior;
- billing/quota management;
- clean-room Cloudflare infrastructure provisioning.

If one becomes a concrete requirement later, it should be owned by a separate Issue rather than keeping #23 open indefinitely.

## 11. Proposed repository changes

Expected additive artifacts:

```text
.env.example
wrangler.semantic-compression.selfhost.jsonc
scripts/selfhost-compression.mjs
package.json                           # selfhost:compression
docs/semantic-compression-selfhost.md # short user guide
test/...                               # launcher/config/regression coverage
```

Exact test filenames may be chosen during implementation planning. No new runtime dependency is expected.

## 12. Error behavior

### Before server start

- `.env` absent: fail with a short setup message;
- malformed `.env`: fail rather than guessing;
- `GEMINI_API_KEY` absent or empty: fail with a short setup message;
- root `.dev.vars` / `.dev.vars.*` present: fail and direct the user to the supported root `.env` path;
- secret values never appear in output;
- unsupported launcher arguments fail rather than being forwarded.

### After server start

Compression request/provider errors continue to use the existing Worker error contract. The wrapper does not create a parallel provider-error vocabulary.

## 13. Verification and acceptance criteria

Issue #23 can be closed for the lightweight self-host scope when all of the following are demonstrated.

### Static/configuration acceptance

- [ ] `.env.example` contains no credential value and documents only the supported local key.
- [ ] `.env` remains ignored by Git.
- [ ] root `.dev.vars` / `.dev.vars.*` cannot silently become an alternate self-host secret source.
- [ ] self-host config contains no KiNoTch. account/resource IDs or Production hostname.
- [ ] self-host config declares only `GEMINI_API_KEY` as required secret.
- [ ] launcher command is fixed to local mode/config and accepts no arbitrary passthrough arguments.
- [ ] launcher child environment excludes Cloudflare deployment credentials.
- [ ] no new dotenv/runtime dependency is introduced.

### Automated acceptance

- [ ] absent/malformed `.env` fails safely;
- [ ] missing/empty `GEMINI_API_KEY` fails safely;
- [ ] root `.dev.vars` / `.dev.vars.*` fails safely before spawn;
- [ ] failure output never contains the key;
- [ ] unrelated `.env` keys are not forwarded to the Worker;
- [ ] the launcher/config starts the existing `semantic-compression-worker.js`, not a fork;
- [ ] `/health` is reachable through the local entry point;
- [ ] existing Compression request/response contract tests remain authoritative and pass;
- [ ] existing full `npm test` passes;
- [ ] `knt verify` passes;
- [ ] Production config/release regression tests pass.

### Real-entry acceptance

With an operator-owned Gemini key supplied locally and without KiNoTch. Production credentials:

1. `npm run selfhost:compression` starts on loopback;
2. `GET /health` succeeds;
3. one synthetic `POST /v1/compress` succeeds;
4. result provenance matches the current reused Core contract;
5. the key is absent from command output, logs, repository diff and generated artifacts;
6. no Cloudflare login, resource creation, deploy or Production mutation is required.

The live Gemini call is opt-in external evidence and is not part of ordinary CI.

## 14. Compatibility and rollback

This is an additive local surface. Existing Production REST/MCP clients are unchanged.

Rollback is repository-only: remove the self-host npm command, config, guide/example, launcher and self-host-specific tests. No data migration, Production rollback or Cloudflare resource cleanup should be necessary because the supported path creates no remote resource.

## 15. Rationale and rejected alternatives

### Selected: lightweight BYOK local REST

This reuses the tested Compression Core, requires only the user's provider key, avoids KiNoTch. credentials/account-specific infrastructure, keeps implementation small, and preserves a clear loopback security boundary.

### Rejected for this scope: full Cloudflare self-host installer

That path would need account IDs, Worker naming, rate-limit namespaces, Service Bindings, Access applications, credentials, deployment sequencing and clean-room validation. It is materially more implementation/support surface than required for local use.

### Rejected for this scope: separate Node compression CLI/core

A parallel implementation would duplicate or drift from Worker/Core behavior. Reusing the Worker keeps one source of truth.

### Rejected for this scope: self-host MCP first

MCP adds authentication/adapter responsibilities unnecessary for the immediate BYOK local-use goal.

## 16. Reconsideration conditions

Create a separate follow-up design if third parties need a public hosted endpoint, Cloudflare-account deployment automation, self-host MCP, a second provider, loopback authentication, or packaging without Node/npm/Wrangler.

Until then, the lightweight BYOK local REST path is the intended completion boundary for Issue #23.
