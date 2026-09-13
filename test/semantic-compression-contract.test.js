import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPRESSION_MODEL,
  COMPRESSION_PROFILE,
  COMPRESSION_PROMPT_VERSION,
  MAX_GEMINI_INPUT_CODE_POINTS,
  MAX_COMPRESSION_TEXT_LENGTH,
  buildCompressionResponse,
  countUnicodeCodePoints,
  sha256Hex,
} from "../src/semantic-compression/contract.js";
import { COMPRESSION_SYSTEM_INSTRUCTION } from "../src/semantic-compression/prompt.js";

test("compression contract fixes profile, prompt version, and model", () => {
  assert.equal(COMPRESSION_PROFILE, "semantic-dense-v1");
  assert.equal(COMPRESSION_PROMPT_VERSION, "semantic-dense-v1");
  assert.equal(COMPRESSION_MODEL, "gemini-3.5-flash-lite");
  assert.equal(MAX_COMPRESSION_TEXT_LENGTH, 1_000_000);
  assert.equal(MAX_GEMINI_INPUT_CODE_POINTS, 200_000);
  assert.match(COMPRESSION_SYSTEM_INSTRUCTION, /入力本文.*圧縮対象データ/s);
  assert.match(COMPRESSION_SYSTEM_INSTRUCTION, /命令文.*実行しない/s);
  assert.match(COMPRESSION_SYSTEM_INSTRUCTION, /数値.*固有名詞.*条件/s);
  assert.match(COMPRESSION_SYSTEM_INSTRUCTION, /因果.*相関/s);
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
    warnings: [],
  });
  assert.deepEqual(Object.keys(response), [
    "compressed_text", "profile", "prompt_version", "model",
    "input_chars", "output_chars", "input_sha256", "output_sha256", "warnings",
  ]);
  assert.equal(response.profile, "semantic-dense-v1");
  assert.equal(response.prompt_version, "semantic-dense-v1");
  assert.equal(response.model, "gemini-3.5-flash-lite");
  assert.equal(response.input_chars, 2);
  assert.equal(response.output_chars, 7);
  assert.deepEqual(response.warnings, []);
});
