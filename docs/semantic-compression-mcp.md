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
4. Restrict the policy to the intended operator identities. Do not put email addresses or policy identity values in this repository.
5. Enable Managed OAuth for the application.
6. Record the Cloudflare One team domain and Application Audience Tag as operator configuration values.
7. Configure Worker vars (not secrets):

   - `TEAM_DOMAIN`: the team hostname, with or without the `https://` prefix; code normalizes it.
   - `POLICY_AUD`: the MCP Access application Audience Tag.

   Apply these two non-secret vars to the bootstrap-deployed Worker through the operator-controlled Cloudflare Worker settings before the first authenticated cookie smoke. The normal release later passes the same values explicitly with Wrangler, so dashboard state is not the normal release source of truth.

The normal production release command requires `TEAM_DOMAIN`, `POLICY_AUD`, `MCP_ENDPOINT`, and `MCP_SMOKE_ACCESS_COOKIE` in its operator environment. It passes `TEAM_DOMAIN` and `POLICY_AUD` explicitly as Wrangler `--var` values on both MCP dry-run and deploy. Do not rely on an untracked local config file or an unverified dashboard-only variable for the release.

The MCP Worker has a dedicated `MCP_RATE_LIMITER` binding for `compress_text`: 5 requests per 60 seconds per client IP. Handshake and discovery requests do not consume this limit. If the binding is missing or fails, the tool fails closed with `rate_limiter_unavailable`; a denied call returns `rate_limited`. The REST Gateway rate limits remain independent.

After Access setup, run the authenticated smoke once, then use the normal release gate:

```powershell
$env:TEAM_DOMAIN = "https://<team>.cloudflareaccess.com"
$env:POLICY_AUD = "<application-audience-tag>"
$env:MCP_ENDPOINT = "https://<actual-worker-host>/mcp"
$env:MCP_SMOKE_ACCESS_COOKIE = "CF_Authorization=<operator-session-cookie>"
npm run smoke:mcp
npm run deploy:production
```

Remove the temporary operator values after the release. Until Access setup and authenticated smoke exist, the Worker must remain fail-closed and MCP production availability is not complete.

## Local checks

Run the deterministic suite without external calls:

```powershell
npm run test:mcp
npm test
```

Dry-run the Worker:

```powershell
npx wrangler deploy --config .\wrangler.semantic-compression-mcp.jsonc --dry-run
```

## MCP Inspector

After Access setup, select Streamable HTTP in MCP Inspector and use the deployed `/mcp` endpoint. Complete the OAuth login, then verify `initialize`, `notifications/initialized`, `tools/list`, and one `tools/call` for `compress_text`. The expected tool input is only `{ "text": "..." }`; do not add a profile or prompt.

Do not paste Access JWTs, API keys, or private text into repository files or terminal transcripts. Run one smoke call at a time; the tool does not add automatic retries.

The repository smoke helper performs the same four protocol operations once, including the `notifications/initialized` lifecycle notification, and requires an operator-provided Access session cookie. `MCP_ENDPOINT` must be an HTTPS URL whose path is exactly `/mcp`, without URL credentials, query, or fragment. This is an Access session-cookie smoke, not proof that a Codex client completed the Managed OAuth client flow; record those as separate evidence.

```powershell
$env:MCP_ENDPOINT = "https://<actual-worker-host>/mcp"
$env:MCP_SMOKE_ACCESS_COOKIE = "CF_Authorization=<operator-session-cookie>"
npm run smoke:mcp
Remove-Item Env:MCP_ENDPOINT, Env:MCP_SMOKE_ACCESS_COOKIE -ErrorAction SilentlyContinue
```

The cookie is temporary operator input only. Never print it, commit it, place it in Codex configuration, or report its value. If the OAuth session expires, authenticate again and rerun the single smoke. The production release gate requires this smoke to pass and records the authentication mode explicitly; it does not fabricate a Codex OAuth result.

## Codex registration

Use the current Codex config schema and keyring-backed OAuth store. The shape is conceptually:

```toml
mcp_oauth_credentials_store = "keyring"

[mcp_servers.semantic_compressor]
url = "https://<actual-worker-host>/mcp"
enabled = true
auth = "oauth"
enabled_tools = ["compress_text"]
tool_timeout_sec = 60
```

Confirm the actual schema supported by the installed Codex version before saving it. Do not add a fixed bearer token or `COMPRESSION_API_TOKEN` to Codex config. Use the client’s OAuth login flow and keyring storage; use its logout/reset operation when credentials must be revoked.

## Release and rollback

The only normal production release command is:

```powershell
npm run deploy:production
```

The one-time `npm run bootstrap:mcp` command is only the pre-Access Worker bootstrap described above; it is not an alternate normal release authority. The normal release gate records MCP version, endpoint, protocol, tool version, smoke, and recovery fields without recording credentials. A failed MCP smoke rolls back the MCP version when a previous version exists. Access bootstrap failures remain an explicit incomplete external operation rather than a fabricated smoke success.

## Troubleshooting

- `authentication_failed`: check the Access application, OAuth login, JWT issuer/audience, and clock; do not disable Worker-side verification.
- `authentication_unavailable`: check `TEAM_DOMAIN` and `POLICY_AUD` Worker vars.
- `rate_limiter_unavailable`: check the `MCP_RATE_LIMITER` binding and its Wrangler ratelimit configuration; do not bypass it.
- `rate_limited`: wait for the 60-second window; do not retry the same tool call in a loop.
- `compression_unavailable`: check the `COMPRESSION` Service Binding and private compression Worker deployment.
- `invalid_upstream_response`: inspect safe Worker status/metadata only; raw Gemini and upstream bodies are intentionally unavailable.
- A direct Worker URL returning an authentication failure is not proof of a completed Access application. Confirm the Access dashboard policy and run an authenticated Inspector/Codex smoke.

## Privacy

Treat `compressed_text` as untrusted display data. Sanitize before HTML rendering, reject dangerous URL schemes, and do not treat this MCP as a prompt-injection sanitizer. The adapter and existing compression Worker do not log the source text, output text outside the intended result, JWTs, or provider credentials.
