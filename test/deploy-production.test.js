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

test("production release includes the private Compression Worker gate and provenance", () => {
  assert.match(source, /wrangler\.semantic-compression\.jsonc/);
  assert.match(source, /assertPrivateWorkerConfig/);
  assert.match(source, /Compression Worker dry-run/);
  assert.match(source, /getActiveCompressionVersionId/);
  assert.match(source, /previousCompressionVersionId/);
  assert.match(source, /compressionVersionId/);
  assert.match(source, /compressionSmoke/);
  assert.match(source, /compressionRecovery/);
  assert.match(source, /compressionModel/);
  assert.match(source, /compressionPromptVersion/);
  assert.match(source, /COMPRESSION_SMOKE_TOKEN/);
});

test("production release fails closed before deployment without Compression smoke token", () => {
  assert.match(source, /Compression smoke requires COMPRESSION_SMOKE_TOKEN/);
  assert.match(source, /compressionDeployed/);
  assert.match(source, /compressionSmokeCompleted/);
});
