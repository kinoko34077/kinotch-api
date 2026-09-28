# Semantic Compression BYOK Local Self-Host Design

**Date:** 2026-09-28

**Status:** Written design awaiting user review. Implementation plan and implementation are intentionally deferred until this document is approved.

**Owning Issue:** #23

## 1. Goal

Provide a lightweight third-party usage path for Semantic Compression that balances implementation cost against usability.

A user who clones `kinotch-api` should be able to supply only their own Gemini API key in a local `.env` file and start the existing Semantic Compression REST worker locally with one npm command.

The target experience is:

```text
git clone <repo>
cd kinotch-api
npm ci
copy .env.example .env
# set GEMINI_API_KEY in .env
npm run selfhost:compression
```

The resulting local endpoint is intended to expose the existing Semantic Compression Worker contract at:

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
thin self-host launcher / Wrangler local config
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

The self-host layer must not maintain its own copies of:

- supported profiles;
- prompt text or prompt versions;
- model selection;
- input limits;
- response schema;
- integrity-warning rules;
- provider request semantics.

If those canonical definitions change, the local self-host path receives the new behavior through the reused Worker/Core automatically.

## 4. User configuration contract

### 4.1 Required user input

Exactly one self-host secret is required for the initial supported path:

```text
GEMINI_API_KEY
```

The repository provides a committed example file containing only the variable name and instructions, never a credential value:

```text
.env.example
```

The user copies it to `.env` and inserts their own key.

The existing repository ignore rules already exclude `.env` and permit `.env.example`.

### 4.2 Secret handling

The self-host path must satisfy all of the following:

- never print the Gemini key;
- never commit the Gemini key;
- never write the key into generated repository files;
- reject or ignore unrelated `.env` keys rather than mapping them into the Worker;
- expose only `GEMINI_API_KEY` to the Worker as the required secret;
- not read the KiNoTch. Production secret file;
- not require `COMPRESSION_API_TOKEN`, Cloudflare Access credentials, Service Tokens, or Cloudflare deployment credentials.

Current Wrangler supports local `.env` / `.dev.vars` secret loading and the `secrets.required` allowlist. The dedicated self-host Wrangler configuration should declare only `GEMINI_API_KEY` as a required secret. No additional dotenv dependency is needed.

A tiny launcher may perform preflight validation so missing `.env` / missing `GEMINI_API_KEY` fails before starting the local server. If the launcher parses `.env`, it must use the Node runtime already required by the repository and must only map the allowlisted key.

## 5. Dedicated self-host configuration

Add a self-host-only Wrangler configuration separate from Production configuration, conceptually:

```text
wrangler.semantic-compression.selfhost.jsonc
```

It should contain only what local execution requires:

- `main: src/semantic-compression-worker.js`;
- a distinct local Worker name;
- the repository-compatible `compatibility_date`;
- `secrets.required = ["GEMINI_API_KEY"]`;
- safe non-secret runtime vars already required by the Worker, such as timeout/log switches;
- local dev binding to `127.0.0.1` and port `8787`.

It must not contain:

- KiNoTch. `account_id`;
- Production Worker routes;
- Production Service Bindings;
- Production rate-limit namespace IDs;
- Cloudflare Access configuration;
- Production KV IDs;
- Production hostnames;
- Production credentials.

The launch command must explicitly use local Wrangler execution and the dedicated self-host config so this path cannot silently become a Production deploy path.

## 6. Launcher boundary

Expose one user-facing command:

```text
npm run selfhost:compression
```

The launcher is intentionally thin. Its responsibilities are limited to:

1. validate that the local secret source is available;
2. validate that `GEMINI_API_KEY` is non-empty without logging it;
3. start Wrangler using the dedicated self-host config in local mode;
4. preserve Wrangler's exit status and normal server output;
5. never invoke `wrangler deploy`, Production release scripts, or Cloudflare resource mutation.

The launcher must not become a general environment mapper, installer, deployment manager, provider router, or configuration framework.

If direct Wrangler `.env` loading plus `secrets.required` can satisfy the preflight acceptance cleanly, the implementation may reduce the launcher to an npm-script-level wrapper rather than adding unnecessary JavaScript. The observable contract above is authoritative; the smallest implementation that satisfies it is preferred.

## 7. Local REST contract

The local path reuses the Worker-level REST surface:

```text
POST /v1/compress
Content-Type: application/json
```

Example request:

```json
{
  "text": "compression input",
  "profile": "semantic-dense-v1"
}
```

Supported profiles, prompt versions, model, limits, response fields and warning behavior are not redefined here. They are inherited from the current Semantic Compression API/Core specification.

The local path also retains the existing Worker health endpoint:

```text
GET /health
```

### Important difference from KiNoTch. Production Gateway

This lightweight local path does **not** reproduce the public Gateway boundary.

Therefore it does not provide the Production Gateway's:

- Bearer `COMPRESSION_API_TOKEN` authentication;
- Gateway pre-auth/authenticated rate limits;
- Gateway Service Binding topology;
- public internet hardening.

That difference is acceptable only because the supported self-host endpoint is loopback-local and is not presented as a public deployment recipe.

## 8. Network and safety boundary

The supported server binds to loopback only:

```text
127.0.0.1:8787
```

The initial self-host feature is not an internet-facing server product.

Documentation must explicitly state:

- do not expose this local endpoint directly to the public internet;
- public/shared-network deployment needs an authentication and abuse-control layer not provided by this lightweight mode;
- using a tunnel, reverse proxy, `0.0.0.0`, container/public host, or Cloudflare deployment is outside this feature's supported security boundary.

This keeps the local path simple without falsely inheriting Production security claims.

## 9. Production isolation

The self-host feature must not change KiNoTch. Production behavior.

Implementation acceptance requires that:

- existing Production Wrangler files remain authoritative for Production;
- existing Production secret mapper behavior is unchanged;
- existing release/deploy commands are unchanged;
- existing Gateway authentication/rate-limit behavior is unchanged;
- existing MCP behavior is unchanged;
- no Cloudflare resource is created or mutated by `selfhost:compression`;
- no Production deploy is performed as part of this work.

The self-host config is an additive local entry point only.

## 10. Non-goals

The following are explicitly outside Issue #23's lightweight completion scope:

- zero-edit deployment to another Cloudflare account;
- creation of rate-limit namespaces;
- creation/configuration of Cloudflare Access applications;
- Service Token setup;
- Managed OAuth setup;
- self-host MCP;
- public REST hosting;
- Docker packaging;
- GUI installer;
- multi-provider support;
- arbitrary model/prompt selection;
- generic LLM proxy behavior;
- automatic billing/quota management;
- clean-room Cloudflare infrastructure provisioning.

If one of these becomes a concrete requirement later, it should be owned by a separate Issue rather than keeping #23 open indefinitely.

## 11. Proposed repository changes

The implementation is expected to remain small and additive.

Likely artifacts:

```text
.env.example
wrangler.semantic-compression.selfhost.jsonc
scripts/selfhost-compression.mjs      # only if preflight needs more than a package script
package.json                           # selfhost:compression command
docs/semantic-compression-selfhost.md # short user guide
test/...                               # config/launcher/regression coverage
```

Exact file names may be adjusted during implementation planning if an existing convention is more appropriate, but the responsibility boundaries in this design must remain unchanged.

No new runtime dependency is expected.

## 12. Error behavior

The self-host entry point must define predictable failure behavior.

### Before server start

- `.env` / selected local secret source absent: fail with a short setup message;
- `GEMINI_API_KEY` absent or empty: fail with a short setup message;
- secret value must never appear in the message;
- malformed local env syntax: fail rather than guessing;
- unsupported launcher arguments: fail rather than forwarding arbitrary Wrangler/deploy arguments.

### After server start

Compression request/provider errors continue to use the existing Worker error contract. The self-host wrapper must not create a parallel provider-error vocabulary.

## 13. Verification and acceptance criteria

Issue #23 can be closed for the lightweight self-host scope when all of the following are demonstrated.

### Static/configuration acceptance

- [ ] `.env.example` contains no credential value and documents only the supported local key.
- [ ] `.env` remains ignored by Git.
- [ ] self-host config contains no KiNoTch. account/resource IDs or Production hostname.
- [ ] self-host config declares only `GEMINI_API_KEY` as the required secret.
- [ ] launch path is fixed to local execution and cannot accept a deploy/remote mode through ordinary passthrough arguments.
- [ ] no new dotenv/runtime dependency is introduced unless implementation proves it necessary.

### Automated acceptance

- [ ] missing local secret source fails safely without printing a key;
- [ ] missing/empty `GEMINI_API_KEY` fails safely;
- [ ] unrelated env-file keys are not exposed as Worker bindings;
- [ ] launcher/config starts the existing `semantic-compression-worker.js`, not a forked implementation;
- [ ] `/health` is available through the local entry point;
- [ ] request validation and response contract remain covered by the existing Compression tests;
- [ ] existing full `npm test` passes;
- [ ] `knt verify` passes;
- [ ] existing Production configuration/release contract regression tests pass.

### Real-entry acceptance

With an operator-owned Gemini key supplied locally and without using KiNoTch. Production credentials:

1. `npm run selfhost:compression` starts on loopback;
2. `GET /health` succeeds;
3. one synthetic `POST /v1/compress` succeeds;
4. the result identifies the same current profile/prompt/model contract as the reused Core;
5. the key is absent from command output, logs, repository diff and generated artifacts;
6. no Cloudflare login, resource creation, deploy or Production mutation is required for the supported local path.

The live Gemini call is opt-in external evidence and must not be part of ordinary CI.

## 14. Compatibility and rollback

This is an additive local surface. Existing Production REST/MCP clients are not migrated and do not need compatibility behavior.

Rollback is repository-only:

- remove the self-host npm command;
- remove the dedicated self-host config/guide/example;
- remove self-host-specific tests/launcher if present.

No data migration, Production rollback or Cloudflare resource cleanup should be necessary because the supported path creates no remote resource.

## 15. Rationale and rejected alternatives

### Selected: lightweight BYOK local REST

Reasons:

- reuses the already-tested Compression Core;
- user supplies only the provider key they own;
- avoids KiNoTch. Production credentials;
- avoids account-specific Cloudflare infrastructure;
- small implementation and maintenance surface;
- useful immediately for developers and local tools;
- preserves a clear security boundary by staying loopback-local.

### Rejected for this scope: full Cloudflare self-host installer

A generic installer would need to own account IDs, Worker naming, rate-limit namespaces, Service Bindings, Access applications, credentials, deployment sequencing and clean-room validation. That is substantially more implementation and support surface than required for local use.

### Rejected for this scope: separate Node compression CLI/core

A parallel local implementation would duplicate Worker/Core behavior or create a second integration path that can drift from the Production contract. Reusing the Worker avoids this.

### Rejected for this scope: self-host MCP first

MCP adds Access/authentication and adapter responsibilities that are unnecessary to satisfy the immediate BYOK local-use goal. It can be considered separately if a concrete need appears.

## 16. Reconsideration conditions

Create a separate follow-up design rather than expanding this feature in place if any of the following becomes required:

- third parties need a public hosted endpoint;
- third parties need Cloudflare-account deployment automation;
- self-host MCP becomes a concrete user requirement;
- a second provider must be supported;
- local clients need authentication even on loopback;
- packaging must work without Node/npm/Wrangler.

Until then, the lightweight BYOK local REST path is the intended completion boundary for Issue #23.
