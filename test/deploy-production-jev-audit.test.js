import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const wrapper = await readFile(new URL("../scripts/deploy-production-with-jev-audit.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("normal production deploy authority routes through the jev-audit wrapper", () => {
  assert.equal(packageJson.scripts["deploy:production"], "node scripts/deploy-production-with-jev-audit.mjs");
  assert.equal(packageJson.scripts.deploy, "npm run deploy:production");
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
