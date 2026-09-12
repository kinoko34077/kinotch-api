import test from "node:test";
import assert from "node:assert/strict";
import {
  createRollbackArgs,
  createWorkerRollbackArgs,
  parseActiveVersionId,
  rollbackAfterSmokeFailure,
} from "../scripts/release-recovery.mjs";

const activeVersionId = "12345678-1234-4234-8234-123456789abc";

test("active version parser selects the 100 percent deployment", () => {
  const status = JSON.stringify({
    strategy: "percentage",
    versions: [
      { version_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", percentage: 0 },
      { version_id: activeVersionId, percentage: 100 },
    ],
  });
  assert.equal(parseActiveVersionId(status), activeVersionId);
});

test("active version parser rejects split deployments without a 100 percent version", () => {
  assert.throws(
    () => parseActiveVersionId(JSON.stringify({ versions: [
      { version_id: activeVersionId, percentage: 50 },
      { version_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", percentage: 50 },
    ] })),
    /100%.*active|active.*100%/i,
  );
});

test("active version parser rejects malformed version IDs", () => {
  assert.throws(
    () => parseActiveVersionId(JSON.stringify({ versions: [{ version_id: "bad", percentage: 100 }] })),
    /version.*id/i,
  );
});

test("rollback args target the saved Text Worker version", () => {
  assert.deepEqual(
    createRollbackArgs(activeVersionId, "rollback after text smoke failure"),
    [
      "wrangler",
      "rollback",
      activeVersionId,
      "--name",
      "text-transform",
      "--message",
      "rollback after text smoke failure",
      "--config",
      "wrangler.text-transform.jsonc",
    ],
  );
});

test("rollback args support the Gateway worker config", () => {
  assert.deepEqual(
    createWorkerRollbackArgs(
      "12345678-1234-1234-1234-123456789abc",
      "rollback gateway after smoke failure",
      { workerName: "api", config: "wrangler.jsonc" },
    ),
    [
      "wrangler",
      "rollback",
      "12345678-1234-1234-1234-123456789abc",
      "--name",
      "api",
      "--message",
      "rollback gateway after smoke failure",
      "--config",
      "wrangler.jsonc",
    ],
  );
});

test("rollback args support the private semantic-compression Worker config", () => {
  assert.deepEqual(
    createWorkerRollbackArgs(
      activeVersionId,
      "rollback compression after smoke failure",
      { workerName: "semantic-compression", config: "wrangler.semantic-compression.jsonc" },
    ),
    [
      "wrangler",
      "rollback",
      activeVersionId,
      "--name",
      "semantic-compression",
      "--message",
      "rollback compression after smoke failure",
      "--config",
      "wrangler.semantic-compression.jsonc",
    ],
  );
});

test("rollback dry scenario reports a successful recovery", async () => {
  const calls = [];
  const result = await rollbackAfterSmokeFailure({
    previousVersionId: activeVersionId,
    rollback: async (versionId) => calls.push(versionId),
  });
  assert.deepEqual(result, { status: "rolled_back", targetVersionId: activeVersionId });
  assert.deepEqual(calls, [activeVersionId]);
});

test("rollback dry scenario propagates a recovery failure", async () => {
  await assert.rejects(
    rollbackAfterSmokeFailure({
      previousVersionId: activeVersionId,
      rollback: async () => { throw new Error("rollback unavailable"); },
    }),
    /rollback unavailable/,
  );
});
