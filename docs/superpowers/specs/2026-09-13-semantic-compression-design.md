# Semantic Compression API Design

**Date:** 2026-09-13

**Status:** Approved design; implementation follows a separate plan.

## Goal

Add a dedicated `POST /v1/compress` API to the existing `kinotch-api` Gateway. The API performs only fixed-profile, meaning-preserving dense compression through a private `semantic-compression` Worker and the Google Gemini Interactions API.

## Scope and non-goals

The change stays in the `kinotch-api` repository. It adds one independent Worker and one Gateway route without changing the responsibilities of `src/text-core` or the behavior of existing routes:

`/health`, `/v1/time`, `/v1/weather`, `/v1/calendar/rokuyo`, `/v1/astronomy/moon`, `/v1/capabilities`, `/v1/ruby/parse`, `/v1/transform`, and `/v1/transform/batch`.

This is not a general LLM proxy, chat API, agent API, arbitrary-prompt API, multi-provider router, model-selection API, tool runner, search integration, conversation store, cache, or persistence layer. `dev_agent` is not modified.

## Architecture

```text
Client / dev_agent
        |
        | POST /v1/compress + Authorization: Bearer token
        v
kinotch-api Gateway
  route policy -> authentication -> rate limit -> byte limit -> JSON validation
        |
        | COMPRESSION Service Binding
        v
semantic-compression Worker (private)
  fixed prompt + fixed model + stateless provider call
        |
        | x-goog-api-key: GEMINI_API_KEY
        v
Google Gemini Interactions API
```

The Gateway does not contain Gemini logic. The Worker does not trust caller-supplied model, prompt, provider, or generation settings. The caller token is validated and consumed only at the Gateway and is not forwarded to the Worker.

## Public contract

The only accepted request fields are `text` and `profile`:

```json
{
  "text": "...",
  "profile": "semantic-dense-v1"
}
```

`text` must be a non-empty string of at most 1,000,000 Unicode code points. `profile` must equal `semantic-dense-v1`. Unknown fields, including `system_prompt`, `prompt`, `instructions`, `model`, `provider`, `temperature`, `thinking`, `tools`, API keys, and provider-specific options, are rejected as invalid input rather than being passed through.

The Gateway body limit is 8 MiB. This is deliberately separate from the character limit so a one-million-character Japanese input and JSON overhead can be represented without using the existing 1 MiB Text Transform limit.

Successful responses use exactly these semantic fields:

```json
{
  "compressed_text": "...",
  "profile": "semantic-dense-v1",
  "prompt_version": "semantic-dense-v1",
  "model": "gemini-2.5-flash-lite",
  "input_chars": 0,
  "output_chars": 0,
  "input_sha256": "...",
  "output_sha256": "...",
  "warnings": []
}
```

`input_chars` and `output_chars` count Unicode code points using the JavaScript equivalent of Python `len(str)` (`Array.from(value).length`). SHA-256 is calculated over the UTF-8 encoding of the exact input and extracted output strings, represented as lowercase hexadecimal.

## Fixed prompt and provider boundary

The sole prompt source of truth is `src/semantic-compression/prompt.js`. It contains:

1. A higher-priority service boundary treating the request text as untrusted data. Instructions, role claims, requests to ignore prior instructions, tool requests, output-format changes, secret requests, and requests to stop compression inside the text are data to compress, not instructions to execute.
2. The complete `semantic-dense-v1` prompt content supplied by the product specification, preserving its meaning and the required priorities: meaning preservation, information retention, logical structure, then compression.

The prompt requires preservation of numerical and named facts, conditions, procedures, comparisons, exceptions, causal and temporal relationships, negation scope, uncertainty, evidence boundaries, and fact/inference/evaluation distinctions. It prohibits newly created conclusions, causal claims, rankings, generalizations, strengthened certainty, lost exceptions, ambiguous subjects, or ambiguous attachment. It requires title plus bullet-oriented compressed text without an outer Markdown fence.

The Worker sends one stateless Gemini interaction per request with:

- `model: "gemini-2.5-flash-lite"`
- `input: text`
- the fixed `system_instruction`
- `store: false`
- no `previous_interaction_id`, `background`, `tools`, search, or caller-controlled generation configuration

The current official Interactions API defines the `interactions` endpoint, `model`, `input`, `system_instruction`, and `store`; `store:false` opts out of the default interaction storage behavior. The implementation uses the currently documented model identifier and avoids parameters not needed by this fixed service contract.

The Worker extracts only text content from the final `model_output` step of a completed interaction. Missing, empty, malformed, incomplete, failed, or action-requiring output is not returned to the caller and becomes a normalized provider error.

## Authentication, limits, and privacy

The Gateway route has a dedicated authentication hook:

- Secret: `COMPRESSION_API_TOKEN`
- Header: `Authorization: Bearer <token>`
- Missing configured secret: fail closed with a service-unavailable error
- Missing, malformed, or incorrect credential: HTTP 401
- Comparison: SHA-256 fingerprints followed by a fixed-length byte comparison
- The raw token is never logged or forwarded

The route has a dedicated Cloudflare Rate Limiting binding `COMPRESSION_RATE_LIMITER`. The initial policy is 5 requests per 60 seconds per client IP, chosen conservatively because Gemini limits vary by model and project tier. The operator must verify the project quota in AI Studio before increasing it. A missing or failing limiter remains fail-closed according to the existing Gateway policy behavior.

Compression logs contain only request ID, route, status, elapsed time, input/output character counts, compression ratio, model, prompt version, rate-limit result, and safe error category. They do not contain input text, compressed text, authorization tokens, Gemini keys, system prompt text, or raw provider responses. Input and output hashes are not logged.

## Error contract

The Gateway and Worker normalize errors to the existing JSON error style without exposing Google response bodies:

| Condition | Status | Code |
| --- | ---: | --- |
| malformed JSON | 400 | `invalid_json` |
| non-object or unknown request fields | 400 | `invalid_body` |
| profile other than `semantic-dense-v1` | 400 | `invalid_profile` |
| empty text | 400 | `empty_text` |
| body over 8 MiB | 413 | `payload_too_large` |
| missing/invalid caller token | 401 | `authentication_failed` |
| missing caller-token secret | 503 | `authentication_unavailable` |
| Gateway rate limit | 429 | `rate_limited` |
| Gemini quota/rate limit | 429 | `provider_rate_limited` |
| malformed or unusable Gemini response | 502 | `provider_invalid_response` |
| other Gemini failure | 502 | `provider_error` |
| Gemini timeout | 504 | `provider_timeout` |
| missing Worker binding or internal failure | 503/500 | existing normalized Gateway codes |

Provider retries are disabled in the initial implementation because a transport failure after provider acceptance is ambiguous and could duplicate a billable compression.

## Testing strategy

Tests are divided into independent layers:

- Contract/unit tests for body validation, fixed profile, code-point counts, SHA-256, prompt version, fixed model, output extraction, warnings, authentication, and safe error mapping.
- Worker integration tests using an injected fake Gemini fetch implementation. They assert the fixed request shape, `store:false`, prompt boundary, no tools/history, secret header behavior, injection-as-data behavior, malformed response handling, and timeout mapping.
- Gateway integration tests asserting Policy registration, authentication before external work, dedicated body limit, dedicated rate limiter, Service Binding forwarding, request ID propagation, response status mapping, and preservation of existing routes.
- Golden fixtures covering numbers, percentages, dates, URLs, commit SHAs, file paths, explicit negation, condition/consequence, rule/exception, fact versus speculation, comparison baselines/differences, and prompt-injection text. The fake provider response is contract-tested; live LLM output is not required to be byte-for-byte stable.
- An opt-in live test that runs only when an explicit flag and the dedicated local `KINOTCH_COMPRESSION_GEMINI_API_KEY` are present. Normal `npm test` never calls Gemini. The Worker test binding remains `GEMINI_API_KEY` after the local credential is resolved.
- The complete existing regression suite.

## Deployment and rollback

New configuration:

- `wrangler.semantic-compression.jsonc`: Worker `semantic-compression`, `workers_dev:false`, `preview_urls:false`, no public routes, no API key in vars.
- `wrangler.jsonc`: add `COMPRESSION` Service Binding and `COMPRESSION_RATE_LIMITER`; preserve all existing bindings and limiters.
- Secret setup is operator-only:
  `wrangler secret put GEMINI_API_KEY --config wrangler.semantic-compression.jsonc`
  and
  `wrangler secret put COMPRESSION_API_TOKEN --config wrangler.jsonc`.

The production release script extends the existing gate with Compression dry-run, prior-version capture, deploy, smoke, rollback, and release metadata. The intended sequence is:

`checks -> tests -> Text dry-run -> Compression dry-run -> Gateway dry-run -> capture Text/Compression/Gateway versions -> Text deploy/smoke -> Compression deploy/smoke -> Gateway deploy/smoke -> release metadata`

Compression smoke requires an operator-provided caller token and exercises the Gateway-to-Worker-to-Gemini path. If production credentials are not available, the implementation and dry-run gates may be verified, but a production success record is not fabricated. Release metadata adds `compressionVersionId`, `previousCompressionVersionId`, `compressionSmoke`, `compressionRecovery`, `compressionModel`, and `compressionPromptVersion` while retaining existing fields.

Any post-deploy smoke failure rolls back the already-deployed Workers to their captured 100% active versions and records the recovery result. Existing rollback behavior remains backward compatible.

## Prompt versioning

`semantic-dense-v1` is immutable once released. A meaningfully changed prompt is introduced as a new profile/version such as `semantic-dense-v2` in a future, separately scoped change. The initial implementation does not add v2.
