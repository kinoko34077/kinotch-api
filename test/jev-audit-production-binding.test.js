import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const PREVIEW_NAMESPACE_ID = "fca5749729da45f0b7c0a095d111999a";

test("private Jev Worker has the dedicated Production benchmark KV binding", async () => {
  const config = await readFile(new URL("../wrangler.jev-audit.jsonc", import.meta.url), "utf8");
  assert.match(config, /"binding"\s*:\s*"JEV_AUDIT_BENCHMARK_STATE"/);
  assert.match(config, /"id"\s*:\s*"3c60e777f1aa4721aa83e7376a67bd4d"/);
});

test("private Jev Worker exposes a bounded benchmark sample-rate runtime control", async () => {
  const config = await readFile(new URL("../wrangler.jev-audit.jsonc", import.meta.url), "utf8");
  assert.match(config, /"JEV_AUDIT_BENCHMARK_SAMPLE_RATE"\s*:\s*"1"/);
});

test("private Jev Worker binds the dedicated KV only for remote preview", async () => {
  const config = await readFile(new URL("../wrangler.jev-audit.jsonc", import.meta.url), "utf8");
  assert.match(config, new RegExp(`\\"binding\\"\\s*:\\s*\\"JEV_AUDIT_BENCHMARK_STATE\\"[\\s\\S]*\\"id\\"\\s*:\\s*\\"3c60e777f1aa4721aa83e7376a67bd4d\\"[\\s\\S]*\\"preview_id\\"\\s*:\\s*\\"${PREVIEW_NAMESPACE_ID}\\"`));
});

test("package scripts expose the remote Jev preview command", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["dev:jev-audit:remote"], "wrangler dev --remote --config wrangler.jev-audit.jsonc");
});
