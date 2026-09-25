import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const operations = await readFile(new URL("../docs/semantic-compression-mcp.md", import.meta.url), "utf8");

test("Codex Service Auth helper workflow documents release-token reuse without embedding credentials", () => {
  assert.match(operations, /http_headers_helper/);
  assert.match(operations, /codex-mcp-access-headers\.mjs/);
  assert.match(operations, /CF_ACCESS_CLIENT_ID/);
  assert.match(operations, /CF_ACCESS_CLIENT_SECRET/);
  assert.match(operations, /release[- ]smoke.*Service Token|release Service Token/is);
  assert.match(operations, /CODEX_CF_ACCESS_CLIENT_ID/);
  assert.match(operations, /CODEX_CF_ACCESS_CLIENT_SECRET/);
  assert.match(operations, /optional|任意/i);
  assert.match(operations, /CF-Access-Client-Id/);
  assert.match(operations, /CF-Access-Client-Secret/);
  assert.match(operations, /Managed OAuth/);
  assert.doesNotMatch(operations, /CODEX_CF_ACCESS_CLIENT_SECRET\s*=\s*[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(operations, /CF_ACCESS_CLIENT_SECRET\s*=\s*[A-Za-z0-9_-]{12,}/);
});
