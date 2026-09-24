# Semantic Compression Remote MCP API

Status: implemented in repository; production availability requires Cloudflare Access bootstrap and authenticated smoke.

## Purpose

This Worker exposes the existing semantic-compression service to MCP clients. It is a thin adapter, not a second compression implementation: Gemini, prompts, profiles, model selection, usage, hashes, and provider error normalization remain owned by the private `semantic-compression` Worker.

## Endpoint and authentication

- Transport: stateless MCP Streamable HTTP.
- Endpoint: `https://<semantic-compression-mcp-worker-host>/mcp`.
- External protection: Cloudflare Access Managed OAuth.
- Worker-side assertion: `Cf-Access-Jwt-Assertion` is verified with Cloudflare Access JWKS, issuer, audience, signature, and expiration.
- Required non-secret Worker vars: `TEAM_DOMAIN`, `POLICY_AUD`.
- The repository smoke endpoint must use `https`, have no explicit port, the exact `/mcp` path, and contain no URL credentials, query, or fragment before its Access cookie is sent.
- Production deploy passes these vars explicitly with Wrangler `--var`; missing values fail before Worker deployment.
- Missing or invalid configuration fails closed.

The REST `/v1/compress` endpoint and `COMPRESSION_API_TOKEN` are separate interfaces. MCP does not accept or forward that token.

## Tool contract

Exactly one tool is published:

`compress_text`

Description: Meaning-preserving dense compression for long text. Preserves conditions, exceptions, uncertainty, numeric values, proper nouns and logical relationships where possible. Use when reducing long intermediate text before handoff or context reuse. It does not summarize according to caller-supplied instructions.

Input is strict and contains only:

```json
{ "text": "..." }
```

The Worker always delegates with profile `semantic-dense-v1`. Callers cannot provide a prompt, system instruction, profile, model, provider, generation option, tool, search setting, or history.

## Internal path and validation

After Access JWT verification, the adapter applies a 2.5 MiB HTTP body-byte guard before handing the request to the MCP framework parser. It checks the declared `Content-Length` when usable and also inspects a cloned request stream, so a misleading or missing length does not bypass the limit. The upstream response must report prompt version `semantic-dense-v1.1`; its `input_chars` and `output_chars` must match the request and compressed result Unicode code-point counts.

```text
MCP client
  -> Cloudflare Access / Managed OAuth
  -> semantic-compression-mcp /mcp
  -> Service Binding COMPRESSION
  -> private semantic-compression /v1/compress
  -> Gemini
```

The adapter reuses the compression contract's Unicode code-point limit (`MAX_GEMINI_INPUT_CODE_POINTS`, currently 200,000). It applies the dedicated `MCP_RATE_LIMITER` only immediately before a `compress_text` Service Binding call: 5 requests per 60 seconds. The preferred key is a non-reversible SHA-256 fingerprint of the validated Access subject/email claim, with `CF-Connecting-IP` as fallback when no stable claim is present. `initialize` and `tools/list` do not consume this compression limit. A missing or failing limiter fails closed, and an exhausted limiter returns `rate_limited`. It sends one binding request and does not retry an accepted compression generation.

The adapter accepts only a successful upstream response with non-empty `compressed_text`, fixed profile `semantic-dense-v1`, a prompt version, a model, valid non-negative character counts, and an array `warnings` field.

## Result and errors

The model-facing MCP result contains the compressed text. Minimal structured provenance may contain `profile`, `prompt_version`, `model`, `input_chars`, `output_chars`, and `warnings`. Token usage, hashes, raw provider output, raw upstream bodies, credentials, and internal diagnostics are not exposed by default.

Safe error categories are `invalid_input`, `payload_too_large`, `authentication_failed`, `compression_unavailable`, `compression_timeout`, `rate_limiter_unavailable`, `rate_limited`, `invalid_upstream_response`, and `internal_error`. Upstream/provider bodies are never copied into an MCP error.

## Privacy

Input text, compressed text outside the intended tool result, Access JWTs, Authorization headers, `COMPRESSION_API_TOKEN`, `GEMINI_API_KEY`, system prompts, and raw Gemini/upstream responses are not logged. The MCP Worker disables automatic invocation logs and may log only request ID, tool, status, elapsed time, safe counts, profile/version, and safe error category.

## Deployment and change control

`npm run deploy:production` remains the sole normal production release authority. The one-time `npm run bootstrap:mcp` path exists only to deploy a never-before-deployed MCP Worker before its Cloudflare Access application and Audience Tag can exist. Bootstrap requires explicit operator confirmation, clean `origin/main` source, tests, and MCP dry-run; it does not require or invent `MCP_ENDPOINT`/`MCP_SMOKE_ACCESS_COOKIE`, does not perform authenticated smoke, and does not mark production availability complete. It refuses to run when an active MCP deployment already exists.

After bootstrap, the operator creates the Access application, enables Managed OAuth, obtains `TEAM_DOMAIN` and `POLICY_AUD`, and completes authenticated smoke. The normal release gate then requires those Access vars plus the endpoint and session cookie, passes the Worker vars explicitly, and includes MCP deploy, smoke, metadata, and rollback. Access application creation, Managed OAuth policy, and authenticated Codex/Inspector smoke are operator-controlled gates and cannot be inferred from repository code.

The opt-in `npm run smoke:mcp` helper performs one `initialize`, one `notifications/initialized` notification, one `tools/list`, and one `tools/call` for `compress_text`. It requires an operator-supplied Access session cookie and validates that the endpoint uses HTTPS, has no explicit port, the exact `/mcp` path, and no URL credentials, query, or fragment. It never retries an MCP call and is not part of the ordinary `npm test` suite. Its result is `authMode: access_session_cookie`; this evidence is separate from a Codex Managed OAuth client-flow smoke, which is recorded as `mcpOAuthSmoke` and cannot be inferred from the cookie test.

Prompt/model/profile changes belong to the REST/compression service change process. This adapter must not copy or mutate those definitions.

See [`docs/semantic-compression-mcp.md`](../semantic-compression-mcp.md) for operator setup and client registration.
