import test from "node:test";
import assert from "node:assert/strict";
import {
  MCP_TOOL_NAME,
  MCP_COMPRESSION_PROFILE,
  validateCompressTextInput,
  buildMcpProvenance,
} from "../src/semantic-compression-mcp/contract.js";
import { MAX_GEMINI_INPUT_CODE_POINTS } from "../src/semantic-compression/contract.js";

test("MCP contract exposes one fixed tool and profile", () => {
  assert.equal(MCP_TOOL_NAME, "compress_text");
  assert.equal(MCP_COMPRESSION_PROFILE, "semantic-dense-v1");
});

test("MCP input accepts only a non-empty text field", () => {
  assert.deepEqual(validateCompressTextInput({ text: "本文" }), {
    ok: true,
    text: "本文",
  });
  assert.equal(validateCompressTextInput({ text: "本文", profile: "compact-v1" }).code, "invalid_input");
  assert.equal(validateCompressTextInput({ text: "" }).code, "invalid_input");
  assert.equal(validateCompressTextInput({ text: 123 }).code, "invalid_input");
});

test("MCP input uses the shared provider context code-point limit", () => {
  const text = "x".repeat(MAX_GEMINI_INPUT_CODE_POINTS + 1);
  const result = validateCompressTextInput({ text });

  assert.deepEqual(result, {
    ok: false,
    code: "payload_too_large",
  });
});

test("MCP provenance keeps only safe public fields", () => {
  assert.deepEqual(buildMcpProvenance({
    profile: "semantic-dense-v1",
    prompt_version: "semantic-dense-v1",
    model: "gemini-3.5-flash-lite",
    input_chars: 12,
    output_chars: 4,
    usage: { input_tokens: 999 },
    input_sha256: "secret-hash-like-value",
  }), {
    profile: "semantic-dense-v1",
    prompt_version: "semantic-dense-v1",
    model: "gemini-3.5-flash-lite",
    input_chars: 12,
    output_chars: 4,
    warnings: [],
  });
});
