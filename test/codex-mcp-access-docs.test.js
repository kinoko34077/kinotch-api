import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const operations = await readFile(new URL("../docs/semantic-compression-mcp.md", import.meta.url), "utf8");

test("Codex Service Auth docs record Policy B while preserving the transitional fallback fact", () => {
  assert.match(operations, /http_headers_helper/);
  assert.match(operations, /codex-mcp-access-headers\.mjs/);
  assert.match(operations, /Policy B/);
  assert.match(operations, /dedicated Codex Service Token/i);
  assert.match(operations, /CODEX_CF_ACCESS_CLIENT_ID/);
  assert.match(operations, /CODEX_CF_ACCESS_CLIENT_SECRET/);
  assert.match(operations, /transitional compatibility behavior/i);
  assert.match(operations, /falls back to `CF_ACCESS_CLIENT_ID` \/ `CF_ACCESS_CLIENT_SECRET`/);
  assert.match(operations, /not.*intended steady-state default/i);
  assert.match(operations, /CF-Access-Client-Id/);
  assert.match(operations, /CF-Access-Client-Secret/);
  assert.match(operations, /Managed OAuth/);
  assert.doesNotMatch(operations, /by default,? reuse the existing release-smoke Service Token/i);
  assert.doesNotMatch(operations, /CODEX_CF_ACCESS_CLIENT_SECRET\s*=\s*[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(operations, /CF_ACCESS_CLIENT_SECRET\s*=\s*[A-Za-z0-9_-]{12,}/);
});

test("Codex Service Auth operations document the bounded one-command machine-local setup", () => {
  assert.match(operations, /npm run setup:codex-mcp-service-auth/);
  assert.match(operations, /configure-codex-mcp-service-auth\.mjs/);
  assert.match(operations, /%USERPROFILE%\\\.codex\\config\.toml/);
  assert.match(operations, /absolute.*codex-mcp-access-headers\.mjs|codex-mcp-access-headers\.mjs.*absolute/i);
  assert.match(operations, /preserv(?:e|es).*unrelated.*config|unrelated.*config.*preserv/i);
  assert.match(operations, /complete logical.*subtree|subtree.*descendant/i);
  assert.match(operations, /does not.*Service Token.*value|Service Token.*value.*not.*config/i);
});
