import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const wrapper = await readFile(new URL("../scripts/deploy-production-with-jev-audit.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("normal production deploy authority routes through the jev-audit wrapper", () => {
  assert.equal(packageJson.scripts["deploy:production"], "node scripts/deploy-production-with-jev-audit.mjs");
  assert.equal(packageJson.scripts.deploy, "npm run deploy:production");
});

test("wrapper enforces clean main source before any jev-audit deployment side effect", () => {
  assert.match(wrapper, /assertProductionSourceRevision/);
  assert.match(wrapper, /status[\s\S]*--porcelain/);
  const cleanGate = wrapper.indexOf("assertCleanWorktree");
  const sourceGate = wrapper.indexOf("assertProductionSourceRevision");
  const deploy = wrapper.indexOf("await phase.deploy()");
  assert.ok(cleanGate >= 0 && sourceGate >= 0 && deploy > cleanGate && deploy > sourceGate);
});

test("wrapper Wrangler calls use the local CLI without shell re-interpretation", () => {
  assert.match(wrapper, /createWranglerInvocation/);
  assert.match(wrapper, /shell:\s*invocation\.shell/);
  assert.doesNotMatch(wrapper, /npxCommand|npx\.cmd/);
});

test("wrapper invokes the nested core release without shell re-interpretation", () => {
  assert.match(wrapper, /runCoreProductionRelease[\s\S]*shell:\s*false/);
});

test("wrapper does not default Git and release child processes to the Windows shell", () => {
  assert.match(wrapper, /shell = false/);
  assert.doesNotMatch(wrapper, /shell = process\.platform/);
});

test("wrapper prepares and deploys jev-audit before the existing core production release", () => {
  assert.match(wrapper, /createJevAuditProductionPhase/);
  const prepare = wrapper.indexOf("await phase.prepare()");
  const deploy = wrapper.indexOf("await phase.deploy()");
  const core = wrapper.indexOf("await runCoreProductionRelease()");
  assert.ok(prepare >= 0 && deploy > prepare && core > deploy);
});

test("wrapper runs live smoke after the core release and recovers on any failure", () => {
  const core = wrapper.indexOf("await runCoreProductionRelease()");
  const smoke = wrapper.indexOf("await phase.smoke()");
  assert.ok(smoke > core);
  assert.match(wrapper, /await phase\.recover\(\)/);
  assert.match(wrapper, /writeJevAuditReleaseRecord/);
  assert.match(wrapper, /status: "succeeded"/);
  assert.match(wrapper, /status: "failed"/);
});

test("post-core jev smoke failure rolls the public Gateway back before jev workers", () => {
  assert.match(wrapper, /previousGatewayVersionId/);
  assert.match(wrapper, /rollbackAfterSmokeFailure/);
  assert.match(wrapper, /automatic-jev-audit-gateway-smoke-failure-rollback/);
  assert.match(wrapper, /runGatewayRecoverySmoke/);
  const gatewayRecovery = wrapper.indexOf("await recoverGatewayAfterJevFailure");
  const jevRecovery = wrapper.indexOf("await phase.recover()");
  assert.ok(gatewayRecovery >= 0 && jevRecovery > gatewayRecovery);
});

test("recovery preserves the original release failure stage in metadata", () => {
  assert.match(wrapper, /const failureStage = state\.stage;/);
  assert.match(wrapper, /failure:\s*\{\s*stage: failureStage,/);
});
