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

test("Current State records the Base gate without editing the Base-managed workflow", async () => {
  const currentState = await readFile(new URL("../project/docs/CURRENT_STATE.md", import.meta.url), "utf8");

  assert.doesNotMatch(currentState, /Confirm the repository-local Base gate on GitHub Actions/);
  assert.match(currentState, /GitHub main protection currently requires `test` and `verify`/);
  assert.match(currentState, /Keep GitHub Actions `test` and `Verify` successful/);
});

test("Current State and development history record the production secret mapper boundary", async () => {
  const currentState = await readFile(new URL("../project/docs/CURRENT_STATE.md", import.meta.url), "utf8");
  const history = await readFile(new URL("../docs/DEVELOPMENT_HISTORY.md", import.meta.url), "utf8");

  assert.match(currentState, /production-secret-mapper\.mjs/);
  assert.match(currentState, /smoke:mcp:local/);
  assert.match(currentState, /release:local/);
  assert.match(currentState, /opaque boundary/);
  assert.match(history, /Production secret mapper/i);
  assert.match(history, /既存release gate/);
  assert.doesNotMatch(history, /CF_Authorization=[A-Za-z0-9_-]{8,}/);
});