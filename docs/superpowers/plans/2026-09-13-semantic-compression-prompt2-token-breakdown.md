# Semantic Compression Prompt 2 and Token Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `semantic-dense-v1` with the exact approved Prompt 2 and expose fixed, profile-specific system-prompt token metadata plus the residual content-input token count without changing the two-profile API shape or per-request latency with an extra count call.

**Architecture:** Keep prompt text and profile mapping in `src/semantic-compression/prompt.js`. Add one metadata source keyed by profile containing the measured prompt SHA-256 and `systemPromptTokens`; production requests use this metadata, while a separate opt-in measurement script calls the official Gemini `models/{model}:countTokens` endpoint once per profile. The existing Interactions generation call remains unchanged except that the Worker adds the derived usage fields to the public response.

**Tech Stack:** JavaScript ESM, Node test runner, Cloudflare Workers/Hono, Web Crypto SHA-256, Gemini REST API, Wrangler.

**Spec:** User-provided `Semantic Compression Prompt 2修正・Token内訳追加 指示書` in the current task.

## Global Constraints

- Keep public profiles exactly `compact-v1` and `semantic-dense-v1`.
- Keep model `gemini-3.5-flash-lite`, `thinking_level: minimal`, `store: false`, and all sampling/tool/history settings unchanged.
- Do not change `compact-v1`, `/v1/compress` request fields, existing usage fields, auth, limits, timeouts, retry policy, Service Binding, Text Core, Candidate evaluation, or `dev_agent`.
- Do not call `countTokens` during a production compression request.
- Treat missing or inconsistent system-token metadata as non-fatal and expose `content_input_tokens: null`, never a negative number.
- Never log or return API keys, raw provider responses, prompt text, or input/output bodies.

### Task 1: Lock the exact Prompt 2 and metadata contract with failing tests

**Files:**
- Modify: `test/semantic-compression-contract.test.js`
- Modify: `test/semantic-compression-usage.test.js`
- Modify: `test/semantic-compression-worker.test.js`
- Modify: `test/semantic-compression-golden.test.js`
- Create: `test/semantic-compression-prompt-metadata.test.js`

**Interfaces:**
- `resolveCompressionProfile(profile)` continues to return `{ profile, promptVersion, systemInstruction }`.
- New `getCompressionPromptMetadata(profile)` returns `{ profile, promptSha256, systemPromptTokens }` or `null`.
- `buildCompressionResponse()` continues to receive normalized camelCase usage and emits the existing five usage fields plus `system_prompt_tokens` and `content_input_tokens`.

- [x] **Step 1: Write assertions for the exact Prompt 2 sentinel and removed legacy text.** Assert the prompt starts with `内容を「意味保存・情報保持優先で高密度圧縮」せよ。`, contains `可能性が高い≠有力(文脈依存)`, `～のような≠～的(文脈依存)`, and `コードブロックでMarkdown出力`, ends with `問題がある場合、圧縮率を下げて意味保存を優先する。`, and does not contain the two forbidden API fence sentences. Assert `COMPACT_V1_PROMPT` is byte-for-byte unchanged from the current test fixture value.
- [x] **Step 2: Write metadata and derivation assertions.** Assert both profiles have metadata, metadata profile keys are exactly the two public profiles, `promptSha256` is a 64-character lowercase SHA-256, and `systemPromptTokens` is a nonnegative safe integer. Assert a helper derives `contentInputTokens` as `inputTokens - systemPromptTokens` only when both are valid and nonnegative and returns `null` when the system count exceeds input or either value is invalid.
- [x] **Step 3: Write public response assertions.** Extend fixture usage to include `systemPromptTokens` and assert the public response emits `system_prompt_tokens` and `content_input_tokens`, preserves `input_tokens` as Provider `total_input_tokens`, and emits `null` for inconsistent metadata.
- [x] **Step 4: Run the focused tests and verify they fail for the missing exact prompt/metadata behavior.** Run `node --test test/semantic-compression-contract.test.js test/semantic-compression-usage.test.js test/semantic-compression-worker.test.js test/semantic-compression-golden.test.js test/semantic-compression-prompt-metadata.test.js`. Expected: failures identify the old Prompt 2 and missing metadata/response fields, not test syntax errors.

### Task 2: Replace Prompt 2 and add one metadata source

**Files:**
- Modify: `src/semantic-compression/prompt.js`
- Create: `src/semantic-compression/prompt-metadata.js`
- Modify: `src/semantic-compression/contract.js`

**Interfaces:**
- `SEMANTIC_DENSE_V1_PROMPT` contains exactly the user-specified Prompt 2, including the context-dependent distinctions and code-block output line, with no Service Boundary/Candidate/injection prefix or suffix.
- `COMPACT_V1_PROMPT` is unchanged.
- `getCompressionPromptMetadata(profile)` is the only runtime lookup for fixed prompt token metadata.
- `deriveContentInputTokens(inputTokens, systemPromptTokens)` returns a nonnegative safe integer or `null`.

- [x] **Step 1: Replace only the `SEMANTIC_DENSE_V1_PROMPT` raw string.** Preserve its profile mapping and leave `COMPACT_V1_PROMPT` untouched.
- [x] **Step 2: Add the metadata module with prompt hash checks.** Store the two measured token counts and corresponding SHA-256 values in one frozen profile-keyed object; export a resolver that returns a copy and rejects unknown profiles. Do not duplicate prompt text in the metadata module.
- [x] **Step 3: Add `deriveContentInputTokens` to the contract module.** Validate both counts with the existing safe nonnegative integer rules; return `inputTokens - systemPromptTokens` only if the result is nonnegative and safe, otherwise `null`.
- [x] **Step 4: Run the focused tests and verify they fail only because measured counts are not yet populated with the post-replacement official values.** Keep the source change isolated from Worker wiring until the prompt hash test is passing.

### Task 3: Add opt-in official countTokens measurement

**Files:**
- Create: `scripts/measure-compression-prompt-tokens.mjs`
- Modify: `package.json`
- Modify: `test/semantic-compression-prompt-metadata.test.js`
- Modify: `docs/semantic-compression.md`

**Interfaces:**
- `countGeminiPromptTokens({ apiKey, profile, fetchImpl })` posts to `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:countTokens` with the selected fixed prompt in the official `generateContentRequest.systemInstruction` shape and no caller input.
- The script requires `KINOTCH_COMPRESSION_GEMINI_API_KEY` and an explicit `RUN_COMPRESSION_PROMPT_TOKEN_MEASURE=true`, calls each profile once with a conservative 15-second interval, prints only profile/model/count/hash metadata, and never prints prompt text or response bodies.
- `npm run measure:compression:prompt-tokens` invokes the script; it is never part of `npm test` or the production request path.

- [x] **Step 1: Add fake countTokens tests.** Assert endpoint/model, `x-goog-api-key` transport, fixed Prompt inclusion, no API key/prompt/raw body in serialized output, successful `totalTokens` parsing, and malformed/missing response rejection without secret disclosure.
- [x] **Step 2: Implement the minimal countTokens adapter/script.** Use the official `models/{model}:countTokens` endpoint with the selected fixed Prompt in the official `contents` shape; keep the selected profile prompt resolved through `resolveCompressionProfile`. Use the dedicated local env var only and fail fast when the explicit flag is set without it.
- [x] **Step 3: Measure both profiles once with the operator-provided key.** Update only the two numeric metadata values and their hashes in `prompt-metadata.js` using the measured result; do not hand-edit a count without a successful official response.
- [x] **Step 4: Run the focused measurement tests.** Verify the script remains opt-in and the metadata hashes match the actual prompt constants.

### Task 4: Wire fixed metadata into the public usage response

**Files:**
- Modify: `src/semantic-compression-worker.js`
- Modify: `src/semantic-compression/contract.js`
- Modify: `src/semantic-compression/gemini.js` only if the normalized internal usage type needs a field-preserving adjustment
- Modify: `test/semantic-compression-worker.test.js`
- Modify: `test/semantic-compression-usage.test.js`
- Modify: `test/smoke-production.test.js`
- Modify: `scripts/smoke-production.mjs`

**Interfaces:**
- Worker response usage is `{ input_tokens, system_prompt_tokens, content_input_tokens, output_tokens, thought_tokens, cached_tokens, total_tokens }`.
- `input_tokens` remains exactly normalized `total_input_tokens`; the new content field is derived from fixed metadata, not a second Provider request.

- [x] **Step 1: Extend Worker tests for both profiles.** Assert profile-specific system counts, residual content count, and `null` on inconsistent metadata; assert the outgoing Interactions body remains unchanged.
- [x] **Step 2: Pass the resolved profile metadata into `buildCompressionResponse`.** Compute the derived residual through `deriveContentInputTokens`; if metadata is missing/stale, preserve 200 generation success and emit null for the new fields.
- [x] **Step 3: Extend contract and smoke validators.** Validate the two new usage keys as safe nonnegative integers or null without exposing them in logs or changing request validation.
- [x] **Step 4: Run focused tests and confirm public response key order/values and no privacy regression.** Do not add usage fields to any Gateway request or production logs.

### Task 5: Documentation, full verification, and separate commit

**Files:**
- Modify: `docs/semantic-compression.md`
- Modify: `README.md` only if the public response example is maintained there
- Modify: `test/semantic-compression-docs.test.js` if required strings are missing

- [x] **Step 1: Document the exact mapping.** State that `input_tokens` is Provider total input, `system_prompt_tokens` is a fixed countTokens measurement for the selected model/profile, and `content_input_tokens` is the nonnegative residual and not a strict body-only token count.
- [x] **Step 2: Document recalculation rules.** Prompt/model changes require rerunning the opt-in count script; per-request countTokens is forbidden; metadata hash mismatch fails tests or the release gate.
- [ ] **Step 3: Run focused tests, then `npm test`, `git diff --check`, and the three Wrangler dry-runs.** Confirm no `src/text-core` or Candidate production mapping changes.
- [x] **Step 4: Run the opt-in live generation test for both profiles once, with the existing 15-second spacing, and verify new fields are present.** Do not run quality Corpus evaluation.
- [ ] **Step 5: Commit only implementation/tests/docs/metadata changes with message `feat: expose compression prompt token breakdown`.** Push only after fresh verification; production deploy remains a separate operator-approved action after live results.

## Verification checklist

- [x] `semantic-dense-v1` exact Prompt 2 hash and forbidden legacy lines absent.
- [x] `compact-v1` unchanged.
- [x] `system_prompt_tokens` metadata matches each prompt hash.
- [x] `content_input_tokens` is residual or null, never negative.
- [x] Existing five usage fields retain their meaning.
- [x] No per-request countTokens call.
- [x] `npm test` passes with only the intentional live skip.
- [x] `git diff --check` passes.
- [x] Production request/response privacy and two-profile contract remain bounded.
