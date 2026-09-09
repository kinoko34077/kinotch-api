import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../scripts/deploy-production.mjs", import.meta.url), "utf8");

test("production release rejects dirty worktrees and generated drift", () => {
  assert.match(source, /status[\s\S]*--porcelain/);
  assert.match(source, /diff[\s\S]*--exit-code/);
  assert.match(source, /clean worktree assertion/);
  assert.match(source, /generated file stability assertion/);
});

test("production release captures and recovers the Gateway version", () => {
  assert.match(source, /getActiveGatewayVersionId/);
  assert.match(source, /previousGatewayVersionId/);
  assert.match(source, /createWorkerRollbackArgs/);
  assert.match(source, /automatic-gateway-smoke-failure-rollback/);
  assert.match(source, /gatewayRecovery/);
});
