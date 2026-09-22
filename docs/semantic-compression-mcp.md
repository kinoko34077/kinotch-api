# Semantic Compression Remote MCP Operations

This document covers the operational setup for `semantic-compression-mcp`. The REST API remains documented by [`docs/specs/semantic-compression-api.md`](specs/semantic-compression-api.md) and [`docs/semantic-compression.md`](semantic-compression.md).

## Cloudflare Access bootstrap

1. Deploy the Worker through the repository release gate; do not create a separate production deploy command.
2. In Cloudflare Zero Trust, create an Access self-hosted application for the deployed `semantic-compression-mcp` Worker hostname.
3. Restrict the policy to the intended operator identities. Do not put email addresses or policy identity values in this repository.
4. Enable Managed OAuth for the application.
5. Record the Cloudflare One team domain and Application Audience Tag as operator configuration values.
6. Configure Worker vars (not secrets):

   - `TEAM_DOMAIN`: the team hostname, with or without the `https://` prefix; code normalizes it.
   - `POLICY_AUD`: the MCP Access application Audience Tag.

Until these values and the Access application exist, the Worker must remain fail-closed and the MCP production gate is not complete.

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

After Access setup, select Streamable HTTP in MCP Inspector and use the deployed `/mcp` endpoint. Complete the OAuth login, then verify `initialize`, `tools/list`, and one `tools/call` for `compress_text`. The expected tool input is only `{ "text": "..." }`; do not add a profile or prompt.

Do not paste Access JWTs, API keys, or private text into repository files or terminal transcripts. Run one smoke call at a time; the tool does not add automatic retries.

The repository smoke helper performs the same three protocol operations once and requires an operator-provided Access session cookie:

```powershell
$env:MCP_ENDPOINT = "https://<actual-worker-host>/mcp"
$env:MCP_SMOKE_ACCESS_COOKIE = "CF_Authorization=<operator-session-cookie>"
npm run smoke:mcp
Remove-Item Env:MCP_ENDPOINT, Env:MCP_SMOKE_ACCESS_COOKIE -ErrorAction SilentlyContinue
```

The cookie is temporary operator input only. Never print it, commit it, place it in Codex configuration, or report its value. If the OAuth session expires, authenticate again and rerun the single smoke.

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

The only production command is:

```powershell
npm run deploy:production
```

The release gate records MCP version, endpoint, protocol, tool version, smoke, and recovery fields without recording credentials. A failed MCP smoke rolls back the MCP version when a previous version exists. Access bootstrap failures remain an explicit incomplete external operation rather than a fabricated smoke success.

## Troubleshooting

- `authentication_failed`: check the Access application, OAuth login, JWT issuer/audience, and clock; do not disable Worker-side verification.
- `authentication_unavailable`: check `TEAM_DOMAIN` and `POLICY_AUD` Worker vars.
- `compression_unavailable`: check the `COMPRESSION` Service Binding and private compression Worker deployment.
- `invalid_upstream_response`: inspect safe Worker status/metadata only; raw Gemini and upstream bodies are intentionally unavailable.
- A direct Worker URL returning an authentication failure is not proof of a completed Access application. Confirm the Access dashboard policy and run an authenticated Inspector/Codex smoke.

## Privacy

Treat `compressed_text` as untrusted display data. Sanitize before HTML rendering, reject dangerous URL schemes, and do not treat this MCP as a prompt-injection sanitizer. The adapter and existing compression Worker do not log the source text, output text outside the intended result, JWTs, or provider credentials.
