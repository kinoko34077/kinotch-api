import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const documentPaths = [
  new URL("../README.md", import.meta.url),
  new URL("../docs/OPERATIONS.md", import.meta.url),
  new URL("../docs/API_PLAN.md", import.meta.url),
  new URL("../docs/semantic-compression.md", import.meta.url),
];
const documentText = (await Promise.all(documentPaths.map((url) => readFile(url, "utf8")))).join("\n");

test("semantic compression operations are documented independently", () => {
  for (const required of [
    "/v1/compress",
    "compact-v1",
    "semantic-dense-v1",
    "gemini-3.5-flash-lite",
    "thinking_level",
    "GEMINI_API_KEY",
    "KINOTCH_COMPRESSION_GEMINI_API_KEY",
    "COMPRESSION_API_TOKEN",
    "COMPRESSION_SMOKE_TOKEN",
    "workers_dev",
    "store:false",
    "8 MiB",
    "5 requests",
    "npm run test:compression:live",
    "Gateway",
    "Compression",
    "Text",
    "本文をログへ残さない",
    "provider_context_limit",
    "200,000",
    "token",
    "RUN_COMPRESSION_QUALITY_EVAL",
    "COMPRESSION_QUALITY_INTERVAL_MS",
    "COMPRESSION_QUALITY_PROMPT_VARIANT",
    "semantic-dense-v2-candidate",
    "semantic-compression-long",
    "analyze-compression-baseline",
    "evaluate:compression",
    "RUN_COMPRESSION_USAGE_MEASURE",
    "COMPRESSION_USAGE_PROMPT_VARIANT",
    "COMPRESSION_USAGE_INTERVAL_MS",
    "measure:compression:usage",
    "cachedTokens",
    "input_tokens",
    "output_tokens",
    "Explicit Context Cache",
  ]) {
    assert.match(documentText, new RegExp(required.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")), required);
  }
  assert.match(documentText, /Gateway[\s\S]*Compression[\s\S]*Text/);
  assert.doesNotMatch(documentText, /\$env:GEMINI_API_KEY/);
});

test("documentation contains placeholders only, never secret-looking values", () => {
  for (const secretName of ["GEMINI_API_KEY", "COMPRESSION_API_TOKEN", "COMPRESSION_SMOKE_TOKEN"]) {
    const valuePattern = new RegExp(`${secretName}\\s*(?:=|:)\\s*["'](?!<)[A-Za-z0-9_-]{8,}["']`);
    assert.doesNotMatch(documentText, valuePattern, secretName);
  }
});
