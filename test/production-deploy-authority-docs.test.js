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

test("Current State records the accepted BYOK main revision and keeps Production provenance separate", async () => {
  const currentState = await readFile(new URL("../project/docs/CURRENT_STATE.md", import.meta.url), "utf8");

  assert.match(currentState, /main`? is `13897b973b80a6ea6af504c2f34dece190ad6d64/);
  assert.match(currentState, /BYOK local Semantic Compression surface/);
  assert.match(currentState, /real local.*E2E|local.*E2E.*verified/i);
  assert.match(currentState, /does not add a Production.*Remote MCP.*Access.*Service Token path/i);
  assert.match(currentState, /latest tracked Production release source remains/);
});

test("development history includes the BYOK implementation and documentation merge commits", async () => {
  const history = await readFile(new URL("../docs/DEVELOPMENT_HISTORY.md", import.meta.url), "utf8");

  assert.match(history, /origin\/main/);
  assert.match(history, /13897b973b80a6ea6af504c2f34dece190ad6d64/);
  assert.match(history, /7e70f948ce4779e82609a37d2592962fa1230a92/);
  assert.match(history, /13897b973b80a6ea6af504c2f34dece190ad6d64/);
  assert.match(history, /Merge PR #53: add bounded BYOK local compression self-host/);
  assert.match(history, /Merge PR #54: align BYOK dotenv documentation/);
  assert.match(history, /local.*E2E|E2E.*local/i);
  assert.doesNotMatch(history, /Production.*BYOK.*deployed/i);
});
