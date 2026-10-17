# Translation API — development contract

Owner: kinotch-api#84. Consumer: kinotch-repo-monitor#83.

## Endpoint
POST /v1/translate, JSON request:
```json
{"text":"Fix issue #83","source_language":"en","target_language":"ja","profile":"technical"}
```
Authentication: `Authorization: Bearer <TRANSLATION_API_TOKEN>`.
Response: `original`, `translated` (string|null), `status` (translated|original), `provider` (azure|google|null), `policy_version`.
Body maximum: 40,000 bytes. Text length: 1–10,000 UTF-16 code units. Shared text rate limiter: 30/minute per caller IP.
No API keys or translated content in browser bundles or logs.

## Provider configuration (not yet configured)
- `TRANSLATION_API_TOKEN`: independent bearer token; required.
- `TRANSLATION_ENABLED=true`: explicit opt-in to outbound translation.
- `AZURE_TRANSLATOR_KEY`, optional `AZURE_TRANSLATOR_REGION`: Azure Translator credentials.
- `GOOGLE_TRANSLATE_API_KEY`: Google Cloud Translation v2 credential.
Azure attempted before Google. Both fail => original returned.
All secrets must be provisioned out of band; never commit or paste credentials.
Provider calls are not exercised in normal tests. A configured provider does not prove that a request is free of charge.

## Security and readiness
The endpoint is currently a development-branch prototype, not a deployed or accepted production service.
Do not enable provider calls until free-only billing restriction is independently proven at the provider/account level.
Translation results are untrusted presentation data and must never alter canonical GitHub state.
Do not send private issues, tokens, or machine state to third-party translation services.
Markdown/code/identifier protection and persistent cache are not implemented; callers must not rely on preservation.
Production deploy remains subject to the existing repository release process and explicit approval.
