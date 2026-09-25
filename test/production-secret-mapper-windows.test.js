import test from "node:test";
import assert from "node:assert/strict";
import {
  MAPPER_MODES,
  resolveMappedCommandInvocation,
} from "../scripts/production-secret-mapper.mjs";

test("Windows production secret mapper launches npm through ComSpec", () => {
  const invocation = resolveMappedCommandInvocation(MAPPER_MODES.MCP_SMOKE, {
    platform: "win32",
    sourceEnv: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
  });

  assert.equal(invocation.command, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(invocation.args, [
    "/d",
    "/s",
    "/c",
    "npm.cmd run smoke:mcp",
  ]);
});

test("Windows production release uses the same fixed cmd wrapper", () => {
  const invocation = resolveMappedCommandInvocation(MAPPER_MODES.PRODUCTION_RELEASE, {
    platform: "win32",
    sourceEnv: { COMSPEC: "C:\\Windows\\System32\\cmd.exe" },
  });

  assert.equal(invocation.command, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(invocation.args, [
    "/d",
    "/s",
    "/c",
    "npm.cmd run deploy:production",
  ]);
});

test("non-Windows production secret mapper launches npm directly", () => {
  const invocation = resolveMappedCommandInvocation(MAPPER_MODES.MCP_SMOKE, {
    platform: "linux",
    sourceEnv: {},
  });

  assert.equal(invocation.command, "npm");
  assert.deepEqual(invocation.args, ["run", "smoke:mcp"]);
});
