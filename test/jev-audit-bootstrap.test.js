import test from "node:test";
import assert from "node:assert/strict";
import {
  JEV_AUDIT_BOOTSTRAP_CONFIRMATION,
  JEV_AUDIT_BOOTSTRAP_MCP_CONFIG,
  JEV_AUDIT_BOOTSTRAP_PRIVATE_CONFIG,
  assertJevAuditBootstrapConfirmation,
  createJevAuditBootstrapDeployArgs,
  resolveJevAuditBootstrapState,
} from "../scripts/jev-audit-bootstrap.mjs";

test("Jev Audit bootstrap requires explicit operator confirmation", () => {
  assert.equal(JEV_AUDIT_BOOTSTRAP_CONFIRMATION, "JEV_AUDIT_BOOTSTRAP_CONFIRM");
  assert.throws(() => assertJevAuditBootstrapConfirmation({}), /JEV_AUDIT_BOOTSTRAP_CONFIRM=true/);
  assert.throws(
    () => assertJevAuditBootstrapConfirmation({ JEV_AUDIT_BOOTSTRAP_CONFIRM: "false" }),
    /JEV_AUDIT_BOOTSTRAP_CONFIRM=true/,
  );
  assert.doesNotThrow(() => assertJevAuditBootstrapConfirmation({ JEV_AUDIT_BOOTSTRAP_CONFIRM: "true" }));
});

test("bootstrap deploys only dedicated Jev Audit Workers without Access vars", () => {
  assert.deepEqual(createJevAuditBootstrapDeployArgs(JEV_AUDIT_BOOTSTRAP_PRIVATE_CONFIG, { dryRun: true }), [
    "wrangler", "deploy", "--config", JEV_AUDIT_BOOTSTRAP_PRIVATE_CONFIG, "--dry-run",
  ]);
  assert.deepEqual(createJevAuditBootstrapDeployArgs(JEV_AUDIT_BOOTSTRAP_MCP_CONFIG), [
    "wrangler", "deploy", "--config", JEV_AUDIT_BOOTSTRAP_MCP_CONFIG,
  ]);
});

test("bootstrap state supports safe resume after private Worker was created", () => {
  assert.deepEqual(resolveJevAuditBootstrapState({ privateVersionId: null, mcpVersionId: null }), {
    deployPrivate: true,
    deployMcp: true,
  });
  assert.deepEqual(resolveJevAuditBootstrapState({ privateVersionId: "private-v1", mcpVersionId: null }), {
    deployPrivate: false,
    deployMcp: true,
  });
  assert.throws(
    () => resolveJevAuditBootstrapState({ privateVersionId: null, mcpVersionId: "mcp-v1" }),
    /MCP Worker exists without the private Worker/,
  );
  assert.throws(
    () => resolveJevAuditBootstrapState({ privateVersionId: "private-v1", mcpVersionId: "mcp-v1" }),
    /only allowed before the initial Jev Audit Worker bootstrap is complete/,
  );
});
