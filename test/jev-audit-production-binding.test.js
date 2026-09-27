import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("private Jev Worker has the dedicated Production benchmark KV binding", async () => {
  const config = await readFile(new URL("../wrangler.jev-audit.jsonc", import.meta.url), "utf8");
  assert.match(config, /"binding"\s*:\s*"JEV_AUDIT_BENCHMARK_STATE"/);
  assert.match(config, /"id"\s*:\s*"3c60e777f1aa4721aa83e7376a67bd4d"/);
});
