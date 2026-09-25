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

test("production release is bound to a fetched origin/main revision", () => {
  assert.match(source, /assertProductionSourceRevision/);
  assert.match(source, /production source revision assertion/);
  assert.match(source, /runGit/);
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
  assert.match(source, /COMPRESSION_PROFILE_COMPACT/);
  assert.match(source, /COMPRESSION_PROFILE_SEMANTIC_DENSE/);
  assert.match(source, /compressionPromptVersions/);
  assert.match(source, /COMPRESSION_SMOKE_TOKEN/);
});

test("production release records the validated MCP endpoint", () => {
  assert.match(source, /state\.mcpEndpoint\s*=\s*mcpSmokeInputs\.endpoint/);
  assert.match(source, /endpoint:\s*state\.mcpEndpoint/);
});

test("production release reinstalls the lockfile dependency tree before build and tests", () => {
  assert.match(source, /state\.stage = "clean dependency install"/);
  assert.match(source, /await runNpm\(\["ci", "--foreground-scripts"\]\)/);
  assert.match(source, /await runNpm\(\["run", "build:text-snapshot"\]\)/);
  assert.ok(source.indexOf('await runNpm(["ci", "--foreground-scripts"])') < source.indexOf('await runNpm(["run", "build:text-snapshot"])'));
});

test("production release sanitizes child environments and scopes Cloudflare credentials to Wrangler", () => {
  assert.match(source, /createReleaseChildEnv/);
  assert.match(source, /env = createReleaseChildEnv\(\)/);
  assert.match(source, /includeCloudflareCredentials:\s*true/);
  assert.doesNotMatch(source, /env:\s*process\.env\s*,?\s*stdio/);
});

test("production Wrangler calls use the local CLI without shell re-interpretation", () => {
  assert.match(source, /createWranglerInvocation/);
  assert.match(source, /shell:\s*invocation\.shell/);
  assert.doesNotMatch(source, /npxCommand|npx\.cmd/);
});

test("production release does not default child processes to the Windows shell", () => {
  assert.match(source, /shell = false/);
  assert.match(source, /createNpmInvocation/);
  assert.doesNotMatch(source, /npmCommand/);
});

test("production release fails closed before deployment without Compression smoke token", () => {
  assert.match(source, /Compression smoke requires COMPRESSION_SMOKE_TOKEN/);
  assert.match(source, /compressionDeployed/);
  assert.match(source, /compressionSmokeCompleted/);
});

test("production release retries only non-billable Compression readiness", () => {
  assert.doesNotMatch(source, /runCompressionSmokeWithRetry/);
  assert.match(source, /runCompressionGatewayReadinessWithRetry/);
  assert.match(source, /COMPRESSION_BINDING_PROPAGATION_SETTLE_MS\s*=\s*30_000/);
  assert.match(source, /await wait\(COMPRESSION_BINDING_PROPAGATION_SETTLE_MS\)/);
  assert.match(source, /runCompressionSmoke\(/);
  assert.match(source, /profile: COMPRESSION_PROFILE_COMPACT/);
  assert.match(source, /profile: COMPRESSION_PROFILE_SEMANTIC_DENSE/);
  assert.match(source, /checkCompression:\s*false/);
});

test("production release passes fixed production smoke targets to every smoke boundary", () => {
  assert.match(source, /PRODUCTION_SMOKE_TARGETS/);
  assert.ok((source.match(/targets:\s*PRODUCTION_SMOKE_TARGETS/g) ?? []).length >= 5);
});

test("production release reconciles deploy failures and verifies rollback recovery", () => {
  assert.match(source, /deployWithReconciliation/);
  assert.match(source, /getActiveVersionId/);
  assert.match(source, /recoverySmoke/);
  assert.match(source, /runGatewayRecoverySmoke/);
  assert.match(source, /runCompressionRecoverySmoke/);
  assert.match(source, /runMcpRecoverySmoke/);
});

test("production release records deployment reconciliation summaries on success", () => {
  assert.match(source, /textDeployment:\s*state\.textDeployment/);
  assert.match(source, /compressionDeployment:\s*state\.compressionDeployment/);
  assert.match(source, /mcpDeployment:\s*state\.mcpDeployment/);
  assert.match(source, /gatewayDeployment:\s*state\.gatewayDeployment/);
});
