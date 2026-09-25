import assert from "node:assert/strict";
import test from "node:test";

import { createJevAuditProductionPhase } from "../scripts/jev-audit-production-phase.mjs";

const PREVIOUS_PRIVATE = "11111111-1111-1111-1111-111111111111";
const PREVIOUS_MCP = "22222222-2222-2222-2222-222222222222";
const NEW_PRIVATE = "33333333-3333-3333-3333-333333333333";
const NEW_MCP = "44444444-4444-4444-4444-444444444444";

function statusJson(versionId) {
  return JSON.stringify({ versions: versionId ? [{ percentage: 100, version_id: versionId }] : [] });
}

function makeHarness() {
  const calls = [];
  const stages = [];
  const mcpSmokeCalls = [];
  let privateVersion = PREVIOUS_PRIVATE;
  let mcpVersion = PREVIOUS_MCP;

  async function runWrangler(args, options = {}) {
    calls.push({ args: [...args], options: { ...options } });
    const text = args.join(" ");
    if (text.includes("deployments status") && text.includes("wrangler.jev-audit-mcp.jsonc")) {
      return { code: 0, output: statusJson(mcpVersion), errorOutput: "", signal: null };
    }
    if (text.includes("deployments status") && text.includes("wrangler.jev-audit.jsonc")) {
      return { code: 0, output: statusJson(privateVersion), errorOutput: "", signal: null };
    }
    if (text.includes("deploy") && !text.includes("--dry-run") && text.includes("wrangler.jev-audit-mcp.jsonc")) {
      mcpVersion = NEW_MCP;
      return `Current Version ID: ${NEW_MCP}`;
    }
    if (text.includes("deploy") && !text.includes("--dry-run") && text.includes("wrangler.jev-audit.jsonc")) {
      privateVersion = NEW_PRIVATE;
      return `Current Version ID: ${NEW_PRIVATE}`;
    }
    if (text.includes("rollback") && text.includes("wrangler.jev-audit-mcp.jsonc")) {
      mcpVersion = PREVIOUS_MCP;
      return undefined;
    }
    if (text.includes("rollback") && text.includes("wrangler.jev-audit.jsonc")) {
      privateVersion = PREVIOUS_PRIVATE;
      return undefined;
    }
    return undefined;
  }

  const phase = createJevAuditProductionPhase({
    runWrangler,
    env: {
      TEAM_DOMAIN: "https://example.cloudflareaccess.com",
      JEV_AUDIT_MCP_POLICY_AUD: "jev-aud",
      JEV_AUDIT_SMOKE_TOKEN: "rest-secret",
      CF_ACCESS_CLIENT_ID: "client-id",
      CF_ACCESS_CLIENT_SECRET: "client-secret",
    },
    onStage: (stage) => stages.push(stage),
    assertPrivateConfig: async () => {},
    runRestSmoke: async () => ({ status: "passed", auditSemanticsVersion: "0.2.12" }),
    runMcpSmoke: async (options) => {
      mcpSmokeCalls.push(options);
      return { status: "passed", toolCall: options.checkToolCall === true };
    },
  });

  return { phase, calls, stages, mcpSmokeCalls };
}

test("phase dry-runs, captures versions, deploys both Workers, then runs live REST/MCP smoke", async () => {
  const { phase, calls, stages, mcpSmokeCalls } = makeHarness();
  await phase.prepare();
  await phase.deploy();
  await phase.smoke();

  const metadata = phase.metadata();
  assert.equal(metadata.previousJevAuditPrivateVersionId, PREVIOUS_PRIVATE);
  assert.equal(metadata.jevAuditPrivateVersionId, NEW_PRIVATE);
  assert.equal(metadata.previousJevAuditMcpVersionId, PREVIOUS_MCP);
  assert.equal(metadata.jevAuditMcpVersionId, NEW_MCP);
  assert.equal(metadata.jevAuditRestSmoke.status, "passed");
  assert.equal(metadata.jevAuditMcpSmoke.toolCall, true);
  assert.equal(mcpSmokeCalls[0].accessClientId, "client-id");
  assert.equal(mcpSmokeCalls[0].accessClientSecret, "client-secret");
  assert.equal(mcpSmokeCalls[0].accessCookie, undefined);
  assert.ok(stages.includes("Jev Audit private Worker dry-run"));
  assert.ok(stages.includes("Jev Audit MCP Worker dry-run"));
  assert.ok(stages.includes("Jev Audit REST smoke"));
  assert.ok(stages.includes("Jev Audit MCP Service Token smoke"));
  assert.ok(calls.some(({ args }) => args.includes("wrangler.jev-audit.jsonc") && args.includes("--dry-run")));
  assert.ok(calls.some(({ args }) => args.includes("wrangler.jev-audit-mcp.jsonc") && args.includes("--dry-run")));
});

test("phase recovery rolls back MCP then private Worker and verifies recovery smoke", async () => {
  const { phase, calls, mcpSmokeCalls } = makeHarness();
  await phase.prepare();
  await phase.deploy();
  const recovery = await phase.recover();

  assert.equal(recovery.jevAuditMcpRecovery.status, "verified_rolled_back");
  assert.equal(recovery.jevAuditPrivateRecovery.status, "verified_rolled_back");
  const rollbackCalls = calls.filter(({ args }) => args.includes("rollback"));
  assert.equal(rollbackCalls.length, 2);
  assert.ok(rollbackCalls[0].args.includes("automatic-jev-audit-mcp-smoke-failure-rollback"));
  assert.ok(rollbackCalls[1].args.includes("automatic-jev-audit-private-smoke-failure-rollback"));
  assert.equal(mcpSmokeCalls.at(-1).accessClientId, "client-id");
  assert.equal(mcpSmokeCalls.at(-1).accessClientSecret, "client-secret");
  assert.equal(mcpSmokeCalls.at(-1).checkToolCall, false);
});
