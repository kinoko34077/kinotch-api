import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import JSON5 from "json5";

import { assertPrivateWorkerConfig } from "../scripts/deploy-guards.mjs";

test("private jev-audit Worker config cannot expose workers.dev, preview URLs, routes, or fake runtime controls", async () => {
  const source = await readFile(new URL("../wrangler.jev-audit.jsonc", import.meta.url), "utf8");
  const config = JSON5.parse(source);

  assert.equal(config.name, "jev-audit");
  assert.equal(config.main, "src/jev-audit-worker.js");
  assert.equal(assertPrivateWorkerConfig(config, "jev-audit"), true);
  assert.equal(config.observability.logs.invocation_logs, false);
  assert.equal(config.vars?.TYPESAFE_API_KEY, undefined);
  assert.equal(config.vars?.ENABLE_REQUEST_LOGS, undefined);
  assert.equal(config.vars?.TYPESAFE_TIMEOUT_MS, undefined);
});
