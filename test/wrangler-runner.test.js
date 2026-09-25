import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createWranglerInvocation } from "../scripts/wrangler-runner.mjs";
import { createWorkerRollbackArgs } from "../scripts/release-recovery.mjs";

test("Wrangler runs through process.execPath without a shell", () => {
  const projectRoot = "C:\\Users\\Author Software\\kinotch-api";
  const invocation = createWranglerInvocation(["deployments", "status", "--json"], { projectRoot });

  assert.equal(invocation.command, process.execPath);
  assert.equal(invocation.shell, false);
  assert.equal(
    invocation.args[0],
    path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js"),
  );
  assert.deepEqual(invocation.args.slice(1), ["deployments", "status", "--json"]);
});

test("rollback message remains one noninteractive argument on a spaced Windows path", () => {
  const message = "automatic rollback after smoke failure";
  const rollbackArgs = createWorkerRollbackArgs(
    "f27aabc3-263b-4851-88e4-15b81d6dd6b3",
    message,
    {
      workerName: "api",
      config: "C:\\Users\\Author Software\\wrangler.jsonc",
    },
  );
  const invocation = createWranglerInvocation(rollbackArgs, {
    projectRoot: "C:\\Users\\Author Software\\kinotch-api",
  });

  assert.equal(invocation.shell, false);
  assert.deepEqual(invocation.args.slice(1), rollbackArgs.slice(1));
  assert.equal(invocation.args[invocation.args.indexOf("--message") + 1], message);
});
