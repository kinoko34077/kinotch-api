# Semantic Compression BYOK Local Self-Host

This guide runs the existing Semantic Compression Worker locally with a Gemini API key owned by the operator. It is a local development surface, not a second Production release path.

## Scope and security boundary

- The only local secret input is the repository-root `.env` file.
- `.env` must contain the operator's own `GEMINI_API_KEY` and must not be committed.
- Root `.dev.vars` and `.dev.vars.*` files are intentionally rejected by the launcher.
- The launcher passes only an allowlisted process environment to Wrangler and explicitly supplies the validated repository-root `.env` through Wrangler's `--env-file` option. The `.env` parser rejects every key other than `GEMINI_API_KEY`.
- The local Worker listens only on `http://127.0.0.1:8787`.
- No Cloudflare account, deployment, Service Token, Access policy, Production credential, or public hostname is configured.
- Local execution does not provide the Production Gateway's caller Bearer authentication or Production rate limit. Keep the endpoint loopback-only.
- The existing `src/semantic-compression-worker.js` and Semantic Compression core are reused; the compression contract and fixed profiles are not duplicated.
- This surface does not start the Remote MCP server.

## Setup

From a clean clone:

```powershell
npm ci
Copy-Item .env.example .env
notepad .env
```

Set the value in `.env` yourself:

```dotenv
GEMINI_API_KEY=<your-own-Gemini-key>
```

Do not put a real key in `.env.example`, documentation, source control, or command history. The launcher accepts no command-line arguments and never prints the key.

## Start the local API

```powershell
npm run selfhost:compression
```

The command starts Wrangler local development with the dedicated `wrangler.semantic-compression.selfhost.jsonc` configuration. It does not run `deploy`, `--remote`, or any Production release script.

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

Expected health endpoint:

```text
GET http://127.0.0.1:8787/health
```

## Call the local API

The local Worker accepts the same Worker-level request contract as the existing Compression Worker:

```powershell
$body = @{ text = "これはローカルBYOK動作確認用の本文です。"; profile = "semantic-dense-v1" } | ConvertTo-Json
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8787/v1/compress `
  -ContentType "application/json" `
  -Body $body
```

The two supported profiles are `compact-v1` and `semantic-dense-v1`:

```json
{"text":"ローカルで圧縮する本文","profile":"compact-v1"}
```

```json
{"text":"ローカルで意味関係を保持して圧縮する本文","profile":"semantic-dense-v1"}
```

The local Worker reuses the fixed model, profile mapping, validation, hash/count, and usage behavior of the existing Semantic Compression Worker. The local endpoint does not accept caller-supplied prompts, models, providers, or generation settings.

## Stop and clean up

Stop the foreground Wrangler process with `Ctrl+C`. Remove the local secret when it is no longer needed:

```powershell
Remove-Item .env
```

Never replace `.env` with a root `.dev.vars` file. The launcher rejects both `.dev.vars` and `.dev.vars.*` to keep the BYOK boundary explicit.

## Troubleshooting

### Missing key

If the command reports that the repository-root `.env` is required or `GEMINI_API_KEY` is required, copy `.env.example` again and set your own key. The missing-key path does not start Wrangler.

### `.dev.vars` rejected

Remove or rename root `.dev.vars` and `.dev.vars.*` files. They are not supported by this local self-host mode because they would create an alternate secret source outside the launcher boundary.

### Port already in use

Stop the existing local Wrangler process using `127.0.0.1:8787`, then run `npm run selfhost:compression` again. Do not change the config to a public address.

### Provider errors

Check the operator-owned Gemini key and the local network connection. Do not add a fallback key, change the fixed model or prompt, or use a Production token. The launcher does not automatically retry Gemini generation requests.

### Production vs local

Production remains the existing `npm run deploy:production` path with Gateway authentication, Service Bindings, rate limits, smoke checks, and rollback. This guide is deliberately limited to loopback local development and does not replace that release authority.
