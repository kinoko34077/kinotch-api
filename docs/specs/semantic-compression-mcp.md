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

```text
MCP client
  -> Cloudflare Access / Managed OAuth
  -> semantic-compression-mcp /mcp
  -> Service Binding COMPRESSION
  -> private semantic-compression /v1/compress
  -> Gemini
```

The adapter reuses the compression contract's Unicode code-point limit (`MAX_GEMINI_INPUT_CODE_POINTS`, currently 200,000). It sends one binding request and does not retry an accepted compression generation.

The adapter accepts only a successful upstream response with non-empty `compressed_text`, fixed profile `semantic-dense-v1`, a prompt version, a model, valid non-negative character counts, and an array `warnings` field.

## Result and errors

The model-facing MCP result contains the compressed text. Minimal structured provenance may contain `profile`, `prompt_version`, `model`, `input_chars`, `output_chars`, and `warnings`. Token usage, hashes, raw provider output, raw upstream bodies, credentials, and internal diagnostics are not exposed by default.

Safe error categories are `invalid_input`, `payload_too_large`, `authentication_failed`, `compression_unavailable`, `compression_timeout`, `rate_limited`, `invalid_upstream_response`, and `internal_error`. Upstream/provider bodies are never copied into an MCP error.

## Privacy

Input text, compressed text outside the intended tool result, Access JWTs, Authorization headers, `COMPRESSION_API_TOKEN`, `GEMINI_API_KEY`, system prompts, and raw Gemini/upstream responses are not logged. The MCP Worker disables automatic invocation logs and may log only request ID, tool, status, elapsed time, safe counts, profile/version, and safe error category.

## Deployment and change control

`npm run deploy:production` remains the sole production release authority. The MCP Worker is included in dry-run, version capture, deploy, readiness, smoke, metadata, and rollback handling. Access application creation, Managed OAuth policy, `TEAM_DOMAIN`, `POLICY_AUD`, and authenticated MCP smoke are operator-controlled gates and cannot be inferred from repository code.

The opt-in `npm run smoke:mcp` helper performs one `initialize`, one `tools/list`, and one `tools/call` for `compress_text`. It requires an operator-supplied Access session cookie, never retries an MCP call, and is not part of the ordinary `npm test` suite.

Prompt/model/profile changes belong to the REST/compression service change process. This adapter must not copy or mutate those definitions.

See [`docs/semantic-compression-mcp.md`](../semantic-compression-mcp.md) for operator setup and client registration.
