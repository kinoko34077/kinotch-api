# Semantic Compression Remote MCP Operations

This document covers the operational setup for `semantic-compression-mcp`. The REST API remains documented by [`docs/specs/semantic-compression-api.md`](specs/semantic-compression-api.md) and [`docs/semantic-compression.md`](semantic-compression.md).

## Cloudflare Access bootstrap

The first deployment has a one-time bootstrap path because the Access application and its Audience Tag do not exist before the Worker exists.

1. Confirm the worktree is clean and on the fetched `origin/main` revision.
2. Set explicit operator confirmation and deploy only the MCP Worker:

   ```powershell
   $env:MCP_BOOTSTRAP_CONFIRM = "true"
   npm run bootstrap:mcp
   Remove-Item Env:MCP_BOOTSTRAP_CONFIRM -ErrorAction SilentlyContinue
   ```

   This command runs the tests and MCP dry-run, deploys `semantic-compression-mcp` without Access vars, and reports `bootstrap_deployed`. It does not run an authenticated smoke, does not deploy the Gateway/Text/Compression release, and must not be treated as production availability. It is fail-closed and refuses to run if the MCP Worker already has an active deployment.
3. In Cloudflare Zero Trust, create an Access self-hosted application for the deployed `semantic-compression-mcp` Worker hostname.
4. Restrict the normal interactive policy to the intended operator identities. Do not put email addresses or policy identity values in this repository.
5. Enable Managed OAuth for the application so Codex and other interactive MCP clients can use the user-authenticated path.
6. Create a dedicated release-smoke Service Token and add a `Service Auth` policy for that exact token on the same Access application. Do not use `Bypass`, and do not replace the interactive Managed OAuth policy.
7. If Codex Service Auth is wanted for non-interactive local use, create a separate Codex-dedicated Service Token and add a `Service Auth` policy for that exact token on the same application. Keep it independently revocable from the release-smoke token.
8. Record the Cloudflare One team domain and Application Audience Tag as operator configuration values.
9. Configure Worker vars (not secrets):

   - `TEAM_DOMAIN`: the team hostname, with or without the `https://` prefix; code normalizes it.
   - `POLICY_AUD`: the MCP Access application Audience Tag.

   Apply these two non-secret vars to the bootstrap-deployed Worker through the operator-controlled Cloudflare Worker settings before the first authenticated smoke. The normal release later passes the same values explicitly with Wrangler, so dashboard state is not the normal release source of truth.

The normal production release command requires `TEAM_DOMAIN`, `POLICY_AUD`, `MCP_ENDPOINT`, `CF_ACCESS_CLIENT_ID`, and `CF_ACCESS_CLIENT_SECRET` in its operator environment. It passes `TEAM_DOMAIN` and `POLICY_AUD` explicitly as Wrangler `--var` values on both MCP dry-run and deploy. The Service Token ID/secret are release-smoke credentials only and are sent to Access as `CF-Access-Client-Id` / `CF-Access-Client-Secret` request headers; they are not Worker vars. Do not rely on an untracked local config file or an unverified dashboard-only variable for the release.

The MCP Worker has a dedicated `MCP_RATE_LIMITER` binding for `compress_text`: 5 requests per 60 seconds. After Access JWT verification, the preferred key is a non-reversible SHA-256 fingerprint of the validated Access subject/email claim; if no stable claim is present, the key falls back to `CF-Connecting-IP`. A Service Token Access assertion can therefore use the existing IP fallback without changing the release-smoke contract. Handshake and discovery requests do not consume this limit. If the binding is missing or fails, the tool fails closed with `rate_limiter_unavailable`; a denied call returns `rate_limited`. The REST Gateway rate limits remain independent.

After Access setup, run the authenticated Service Token smoke once, then use the normal release gate. The preferred operator path is the fixed external secret mapper:

```powershell
npm run smoke:mcp:local
npm run release:local
```

If direct environment variables are required for diagnostics, the equivalent release inputs are:

```powershell
$env:TEAM_DOMAIN = "https://<team>.cloudflareaccess.com"
$env:POLICY_AUD = "<application-audience-tag>"
$env:MCP_ENDPOINT = "https://semantic-compression-mcp.kinotch.workers.dev/mcp"
$env:CF_ACCESS_CLIENT_ID = "<release-smoke-service-token-client-id>"
$env:CF_ACCESS_CLIENT_SECRET = "<release-smoke-service-token-client-secret>"
npm run smoke:mcp
npm run deploy:production
```

Remove temporary operator values after the release. Until Access setup and authenticated Service Token smoke exist, the Worker must remain fail-closed and MCP production release verification is not complete.

## Local checks

The MCP Worker verifies the Access JWT first, then applies the shared 2.5 MiB HTTP body-byte limit before the MCP framework parses JSON-RPC. Both a usable `Content-Length` and the cloned request stream are checked. The existing 200,000 Unicode code-point limit and the 5 requests / 60 seconds `compress_text` limiter remain separate downstream controls.

Run the deterministic suite without external calls:

```powershell
npm run test:mcp
npm test
```

Dry-run the Worker:

```powershell
npx wrangler deploy --config .\wrangler.semantic-compression-mcp.jsonc --dry-run
```

## MCP Inspector and Codex OAuth

Managed OAuth remains the interactive user-authenticated path. In MCP Inspector, select Streamable HTTP and use the deployed `/mcp` endpoint. Complete the OAuth login, then verify `initialize`, `notifications/initialized`, `tools/list`, and one `tools/call` for `compress_text`. The expected tool input is only `{ "text": "..." }`; do not add a profile or prompt.

Do not paste Access JWTs, API keys, Service Token credentials, or private text into repository files or terminal transcripts. Run one smoke call at a time; the tool does not add automatic retries.

The repository smoke helper performs the same four protocol operations once, including the `notifications/initialized` lifecycle notification, but authenticates the automated release path with the dedicated release Service Token. The normal production release accepts only `https://semantic-compression-mcp.kinotch.workers.dev/mcp`; HTTPS, no explicit port, `/mcp`, no credentials, no query, and no fragment are enforced, and another Worker hostname fails before any Service Token-bearing request. This is an Access Service Token smoke, not proof that a Codex client completed the Managed OAuth client flow; record those as separate evidence.

For the release smoke, the client sends the two Cloudflare Access headers only:

```text
CF-Access-Client-Id: <release-smoke service-token client id>
CF-Access-Client-Secret: <release-smoke service-token client secret>
```

The smoke does not send a browser `Cookie` header or reuse the REST `COMPRESSION_API_TOKEN`. Missing either Service Token field fails before network access. Safe HTTP failure diagnostics report only status, normalized content type, and an optional bounded error code; they never print the response body or Service Token values. A 401/403 therefore indicates an Access Service Auth policy/credential problem to investigate without weakening Worker-side JWT verification.

## Codex registration

Codex supports two intentionally separate authentication paths for this MCP.

### Managed OAuth

Managed OAuth remains available when interactive user authentication is desired. Use the current installed Codex schema and keyring-backed OAuth store. A conceptual configuration is:

```toml
mcp_oauth_credentials_store = "keyring"

[mcp_servers.semantic_compressor]
url = "https://semantic-compression-mcp.kinotch.workers.dev/mcp"
enabled = true
auth = "oauth"
enabled_tools = ["compress_text"]
tool_timeout_sec = 60
```

Confirm the actual schema supported by the installed Codex version before saving it. Do not add a fixed bearer token, release Service Token, or `COMPRESSION_API_TOKEN` to Codex config.

### Service Auth through `http_headers_helper`

For non-interactive Codex access, use a Codex-dedicated Service Token rather than reusing the release-smoke token. Store only these two additional keys in the existing fixed external secret file `%USERPROFILE%\.kinotch-secrets\kinotch-api.production.env`:

```text
CODEX_CF_ACCESS_CLIENT_ID=<codex-service-token-client-id>
CODEX_CF_ACCESS_CLIENT_SECRET=<codex-service-token-client-secret>
```

These keys are not part of the Production release required-key set. `release:local` and `smoke:mcp:local` continue to use their existing release credentials; they do not require or forward the Codex-only pair.

`scripts/codex-mcp-access-headers.mjs` reads the same fixed secret-file path, requires only the Codex-specific pair, accepts no alternate path argument, and writes exactly one JSON object to stdout containing:

```text
CF-Access-Client-Id
CF-Access-Client-Secret
```

Codex's current `mcp_servers.<id>.http_headers_helper` setting accepts a local command whose stdout is a JSON object of HTTP header names and values. Point it directly at the Node helper; do not wrap it in `npm run`, because npm adds human-readable output to stdout. Example using a placeholder local repository path:

```toml
[mcp_servers.semantic_compressor]
url = "https://semantic-compression-mcp.kinotch.workers.dev/mcp"
enabled = true
enabled_tools = ["compress_text"]
tool_timeout_sec = 60
http_headers_helper = 'node "C:/path/to/kinotch-api/scripts/codex-mcp-access-headers.mjs"'
```

Do not embed either Service Token value in TOML. Do not set `http_headers` with literal credentials. The helper is only a credential-injection boundary; it does not implement MCP, alter the Worker, or create another Production release authority.

Before using this mode, the operator must create/select the Codex-dedicated Cloudflare Access Service Token and add a `Service Auth` policy for that exact token to the same Access application. Keep the existing Managed OAuth policy intact and do not use `Bypass`.

Verification for Codex Service Auth is one synthetic `compress_text` call without an interactive OAuth prompt. Confirm `initialize`, `tools/list`, tool discovery, one `compress_text` result, and the expected public contract `semantic-dense-v1` / `semantic-dense-v1.1` / `gemini-3.5-flash-lite`. Do not loop or auto-retry the tool call.

## Release and rollback

The only normal production release command is:

```powershell
npm run deploy:production
```

`npm run release:local` is only the fixed local secret-injection launcher for that authority. The one-time `npm run bootstrap:mcp` command is only the pre-Access Worker bootstrap described above; it is not an alternate normal release authority. The normal release gate records MCP version, endpoint, protocol, tool version, smoke auth mode, and recovery fields without recording credentials. A failed deploy is reconciled against the remote active Version before recovery state is recorded. A failed MCP smoke rolls back the MCP version when a previous version exists, verifies that the requested Version is active again, and runs a non-billable MCP handshake recovery smoke using the same release Service Token inputs. Access bootstrap failures remain an explicit incomplete external operation rather than a fabricated smoke success.

The release metadata keeps `mcpOAuthSmoke` separate and operator-required because the automated release Service Token smoke is not evidence of a successful Codex Managed OAuth flow. Codex Service Auth through `http_headers_helper` is also separate operator evidence and does not rewrite historical release metadata.

## Troubleshooting

- Release Service Token smoke `401` / `403`: check the exact release-smoke Service Token, `Service Auth` policy, application hostname, and token validity; do not switch the policy to `Bypass`.
- Codex Service Auth `401` / `403`: check the Codex-dedicated Service Token and its exact `Service Auth` policy; do not substitute the release credential silently.
- Codex helper exits non-zero before connection: confirm both `CODEX_CF_ACCESS_CLIENT_ID` and `CODEX_CF_ACCESS_CLIENT_SECRET` exist and are non-empty in the fixed external secret file.
- `authentication_failed`: check the Access application, JWT issuer/audience/signature/expiry, and clock; do not disable Worker-side verification.
- `authentication_unavailable`: check `TEAM_DOMAIN` and `POLICY_AUD` Worker vars.
- `rate_limiter_unavailable`: check the `MCP_RATE_LIMITER` binding and its Wrangler ratelimit configuration; do not bypass it.
- `rate_limited`: wait for the 60-second window; do not retry the same tool call in a loop.
- `compression_unavailable`: check the `COMPRESSION` Service Binding and private compression Worker deployment.
- `invalid_upstream_response`: inspect safe Worker status/metadata only; raw Gemini and upstream bodies are intentionally unavailable.
- A direct Worker URL returning an authentication failure is not proof of a completed interactive OAuth or Codex Service Auth path. Confirm the specific Access path being tested.

## Privacy

Treat `compressed_text` as untrusted display data. Sanitize before HTML rendering, reject dangerous URL schemes, and do not treat this MCP as a prompt-injection sanitizer. The adapter and existing compression Worker do not log the source text, output text outside the intended result, JWTs, Service Token credentials, or provider credentials.
