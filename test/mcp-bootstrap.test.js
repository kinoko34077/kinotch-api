import test from "node:test";
import assert from "node:assert/strict";
import {
  MCP_BOOTSTRAP_CONFIG,
  assertMcpBootstrapConfirmation,
  createMcpBootstrapDeployArgs,
} from "../scripts/mcp-bootstrap.mjs";

test("MCP bootstrap requires explicit operator confirmation", () => {
  assert.throws(
    () => assertMcpBootstrapConfirmation({}),
    /MCP_BOOTSTRAP_CONFIRM=true/,
  );
  assert.throws(
    () => assertMcpBootstrapConfirmation({ MCP_BOOTSTRAP_CONFIRM: "false" }),
    /MCP_BOOTSTRAP_CONFIRM=true/,
  );
  assert.doesNotThrow(() => assertMcpBootstrapConfirmation({ MCP_BOOTSTRAP_CONFIRM: "true" }));
});

test("MCP bootstrap deploy does not require post-Access endpoint or cookie", () => {
  assert.deepEqual(createMcpBootstrapDeployArgs({ dryRun: true }), [
    "wrangler",
    "deploy",
    "--config",
    MCP_BOOTSTRAP_CONFIG,
    "--dry-run",
  ]);
});
