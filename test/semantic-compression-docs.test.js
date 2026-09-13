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
    "semantic-dense-v1",
    "gemini-2.5-flash-lite",
    "GEMINI_API_KEY",
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
  ]) {
    assert.match(documentText, new RegExp(required.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")), required);
  }
  assert.match(documentText, /Gateway[\s\S]*Compression[\s\S]*Text/);
});

test("documentation contains placeholders only, never secret-looking values", () => {
  for (const secretName of ["GEMINI_API_KEY", "COMPRESSION_API_TOKEN", "COMPRESSION_SMOKE_TOKEN"]) {
    const valuePattern = new RegExp(`${secretName}\\s*(?:=|:)\\s*["'](?!<)[A-Za-z0-9_-]{8,}["']`);
    assert.doesNotMatch(documentText, valuePattern, secretName);
  }
});
