import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("operations documentation defines the single production deploy authority", async () => {
  const operations = await readFile(new URL("../docs/OPERATIONS.md", import.meta.url), "utf8");

  assert.match(operations, /Production deploy authority/);
  assert.match(operations, /npm run deploy:production/);
  assert.match(operations, /main.*push.*(?:直接|production|本番)/is);
  assert.match(operations, /Cloudflare Workers Builds.*(?:無効|auto.?deploy|自動)/is);
  assert.match(operations, /required.*(?:status )?check.*test/is);
  assert.match(operations, /force push.*(?:禁止|不可|無効)/is);
  assert.match(operations, /(?:branch )?delet(?:e|ion).*?(?:禁止|不可|無効)/is);
});
