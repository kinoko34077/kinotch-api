import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPRESSION_MODEL,
  COMPRESSION_THINKING_LEVEL,
  COMPRESSION_PROFILE_COMPACT,
  COMPRESSION_PROFILE_SEMANTIC_DENSE,
  COMPRESSION_PROFILES,
  COMPRESSION_PROFILE,
  COMPRESSION_PROMPT_VERSION,
  MAX_GEMINI_INPUT_CODE_POINTS,
  MAX_COMPRESSION_TEXT_LENGTH,
  buildCompressionResponse,
  countUnicodeCodePoints,
  sha256Hex,
} from "../src/semantic-compression/contract.js";
import {
  COMPACT_V1_PROMPT,
  SEMANTIC_DENSE_V1_PROMPT,
  COMPRESSION_SYSTEM_INSTRUCTION,
  resolveCompressionProfile,
} from "../src/semantic-compression/prompt.js";

test("compression contract fixes profile, prompt version, and model", () => {
  assert.deepEqual(COMPRESSION_PROFILES, ["compact-v1", "semantic-dense-v1"]);
  assert.equal(COMPRESSION_PROFILE_COMPACT, "compact-v1");
  assert.equal(COMPRESSION_PROFILE_SEMANTIC_DENSE, "semantic-dense-v1");
  assert.equal(COMPRESSION_PROFILE, "semantic-dense-v1");
  assert.equal(COMPRESSION_PROMPT_VERSION, "semantic-dense-v1");
  assert.equal(COMPRESSION_MODEL, "gemini-3.5-flash-lite");
  assert.equal(COMPRESSION_THINKING_LEVEL, "minimal");
  assert.equal(MAX_COMPRESSION_TEXT_LENGTH, 1_000_000);
  assert.equal(MAX_GEMINI_INPUT_CODE_POINTS, 200_000);
  assert.equal(COMPRESSION_SYSTEM_INSTRUCTION, SEMANTIC_DENSE_V1_PROMPT);
  assert.match(COMPRESSION_SYSTEM_INSTRUCTION, /^内容を「意味保存・情報保持優先で高密度圧縮」せよ。/);
  assert.doesNotMatch(COMPRESSION_SYSTEM_INSTRUCTION, /入力本文.*圧縮対象データ/s);
  assert.match(COMPACT_V1_PROMPT, /^### 圧縮された要約/);
  assert.match(COMPACT_V1_PROMPT, /Markdownでコードブロック出力/);
  assert.deepEqual(resolveCompressionProfile("compact-v1"), {
    profile: "compact-v1",
    promptVersion: "compact-v1",
    systemInstruction: COMPACT_V1_PROMPT,
  });
  assert.deepEqual(resolveCompressionProfile("semantic-dense-v1"), {
    profile: "semantic-dense-v1",
    promptVersion: "semantic-dense-v1",
    systemInstruction: SEMANTIC_DENSE_V1_PROMPT,
  });
  assert.equal(resolveCompressionProfile("unknown"), null);
});

test("Unicode code-point count matches Python len for astral characters", () => {
  assert.equal(countUnicodeCodePoints("A😀𠮷"), 3);
});

test("SHA-256 is calculated from the exact UTF-8 text", async () => {
  assert.equal(
    await sha256Hex("学校", globalThis.crypto),
    "dc6e2aafeb9e125b69d1b143f05c66414e6e1a4f46c163a52a6d289efeef27c7",
  );
});

test("success response contains the fixed provenance contract", async () => {
  const response = await buildCompressionResponse({
    compressedText: "題名\n- 内容",
    inputText: "入力",
    usage: {
      inputTokens: 100,
      outputTokens: 30,
      thoughtTokens: 0,
      cachedTokens: 10,
      totalTokens: 130,
    },
    warnings: [],
  });
  assert.deepEqual(Object.keys(response), [
    "compressed_text", "profile", "prompt_version", "model",
    "input_chars", "output_chars", "input_sha256", "output_sha256", "usage", "warnings",
  ]);
  assert.equal(response.profile, "semantic-dense-v1");
  assert.equal(response.prompt_version, "semantic-dense-v1");
  assert.equal(response.model, "gemini-3.5-flash-lite");
  assert.equal(response.input_chars, 2);
  assert.equal(response.output_chars, 7);
  assert.deepEqual(response.usage, {
    input_tokens: 100,
    output_tokens: 30,
    thought_tokens: 0,
    cached_tokens: 10,
    total_tokens: 130,
  });
  assert.deepEqual(response.warnings, []);
});
