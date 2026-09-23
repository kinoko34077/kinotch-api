import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import JSON5 from "json5";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const textWorkerConfig = JSON5.parse(await readFile(new URL("../wrangler.text-transform.jsonc", import.meta.url), "utf8"));
const operations = await readFile(new URL("../docs/OPERATIONS.md", import.meta.url), "utf8");

test("production is the only normal deploy authority", () => {
  assert.equal(packageJson.scripts.deploy, "npm run deploy:production");
  assert.equal(packageJson.scripts["deploy:text-transform"], undefined);
  assert.match(operations, /Production deploy authority is only `npm run deploy:production`/);
  assert.match(operations, /admin.*検証されていないcommit.*main.*直接pushしない/i);
});

test("Text Worker automatic invocation logs remain disabled", () => {
  assert.equal(textWorkerConfig.observability.logs.invocation_logs, false);
});
