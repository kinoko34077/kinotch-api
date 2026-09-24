import test from "node:test";
import assert from "node:assert/strict";
import { deployWithReconciliation } from "../scripts/release-deploy.mjs";

const previousVersionId = "12345678-1234-4234-8234-123456789abc";
const deployedVersionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("deploy reconciliation reports the parsed version after a normal deploy", async () => {
  const result = await deployWithReconciliation({
    deploy: async () => "deployment output",
    parseVersionId: () => deployedVersionId,
    getActiveVersionId: async () => deployedVersionId,
    previousVersionId,
  });

  assert.deepEqual(result, {
    status: "deployed",
    versionId: deployedVersionId,
    deployed: true,
    needsRollback: false,
  });
});

test("deploy reconciliation marks a remote change when the command fails after deploy", async () => {
  const deployError = new Error("connection closed after upload");
  const result = await deployWithReconciliation({
    deploy: async () => { throw deployError; },
    parseVersionId: () => deployedVersionId,
    getActiveVersionId: async () => deployedVersionId,
    previousVersionId,
  });

  assert.equal(result.status, "remote_changed_after_failure");
  assert.equal(result.versionId, deployedVersionId);
  assert.equal(result.deployed, true);
  assert.equal(result.needsRollback, true);
  assert.equal(result.error, deployError);
});

test("deploy reconciliation does not mark a deployment when the active version is unchanged", async () => {
  const deployError = new Error("deploy failed before upload");
  const result = await deployWithReconciliation({
    deploy: async () => { throw deployError; },
    parseVersionId: () => deployedVersionId,
    getActiveVersionId: async () => previousVersionId,
    previousVersionId,
  });

  assert.deepEqual(result, {
    status: "deploy_failed",
    versionId: null,
    deployed: false,
    needsRollback: false,
    error: deployError,
  });
});

test("deploy reconciliation fails safe and schedules rollback when remote status is unavailable", async () => {
  const deployError = new Error("deploy response lost");
  const result = await deployWithReconciliation({
    deploy: async () => { throw deployError; },
    parseVersionId: () => deployedVersionId,
    getActiveVersionId: async () => { throw new Error("status unavailable"); },
    previousVersionId,
  });

  assert.equal(result.status, "reconciliation_failed");
  assert.equal(result.versionId, null);
  assert.equal(result.deployed, true);
  assert.equal(result.needsRollback, true);
  assert.equal(result.error, deployError);
  assert.match(result.reconciliationError.message, /status unavailable/);
});
