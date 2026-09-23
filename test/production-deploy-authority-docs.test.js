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

test("Verify workflow is pinned and current state records the Base gate evidence", async () => {
  const workflow = await readFile(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");
  const currentState = await readFile(new URL("../project/docs/CURRENT_STATE.md", import.meta.url), "utf8");

  assert.match(workflow, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262\s+# v4/);
  assert.doesNotMatch(workflow, /actions\/checkout@v4/);
  assert.doesNotMatch(currentState, /Confirm the repository-local Base gate on GitHub Actions/);
  assert.match(currentState, /GitHub Actions `Verify`: success/);
});
