import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import JSON5 from "json5";
import {
  MCP_TOOL_NAME,
  MCP_COMPRESSION_PROFILE,
  MCP_EXPECTED_PROMPT_VERSION,
  validateCompressTextInput,
  buildMcpProvenance,
} from "../src/semantic-compression-mcp/contract.js";
import {
  COMPRESSION_PROMPT_VERSION,
  COMPRESSION_BODY_LIMIT_BYTES,
  MAX_GEMINI_INPUT_CODE_POINTS,
} from "../src/semantic-compression/contract.js";
import { routePolicies } from "../src/policies/routes.js";
import { MCP_TRANSPORT_BODY_LIMIT_BYTES } from "../src/semantic-compression-mcp/body-limit.js";

test("MCP contract exposes one fixed tool and profile", () => {
  assert.equal(MCP_TOOL_NAME, "compress_text");
  assert.equal(MCP_COMPRESSION_PROFILE, "semantic-dense-v1");
  assert.equal(MCP_EXPECTED_PROMPT_VERSION, COMPRESSION_PROMPT_VERSION);
  assert.equal(MCP_EXPECTED_PROMPT_VERSION, "semantic-dense-v1.1");
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
    prompt_version: "semantic-dense-v1.1",
    model: "gemini-3.5-flash-lite",
    input_chars: 12,
    output_chars: 4,
    usage: { input_tokens: 999 },
    input_sha256: "secret-hash-like-value",
  }), {
    profile: "semantic-dense-v1",
    prompt_version: "semantic-dense-v1.1",
    model: "gemini-3.5-flash-lite",
    input_chars: 12,
    output_chars: 4,
    warnings: [],
  });
});

test("MCP Worker config defines a dedicated 5/60 compression limiter", async () => {
  const config = JSON5.parse(await readFile(new URL("../wrangler.semantic-compression-mcp.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.ratelimits, [{
    name: "MCP_RATE_LIMITER",
    namespace_id: "26090806",
    simple: { limit: 5, period: 60 },
  }]);
});

test("MCP transport body guard shares the Compression Gateway byte limit", () => {
  assert.equal(MCP_TRANSPORT_BODY_LIMIT_BYTES, COMPRESSION_BODY_LIMIT_BYTES);
  assert.equal(MCP_TRANSPORT_BODY_LIMIT_BYTES, routePolicies.compression.bodyLimitBytes);
});
