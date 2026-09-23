import test from "node:test";
import assert from "node:assert/strict";
import { assertProductionSourceRevision } from "../scripts/production-source-gate.mjs";

const HEAD = "a".repeat(40);
const OTHER_HEAD = "b".repeat(40);

function fakeGit({ branch = "main", head = HEAD, originHead = HEAD, fetchError = null } = {}) {
  const calls = [];
  const runGit = async (args) => {
    calls.push(args);
    if (args[0] === "fetch" && fetchError) throw new Error(fetchError);
    if (args[0] === "branch") return `${branch}\n`;
    if (args[0] === "rev-parse" && args[1] === "HEAD") return `${head}\n`;
    if (args[0] === "rev-parse" && args[1] === "origin/main") return `${originHead}\n`;
    return "";
  };
  return { calls, runGit };
}

test("production source gate fetches origin/main and accepts matching main", async () => {
  const fake = fakeGit();
  const result = await assertProductionSourceRevision({ runGit: fake.runGit });

  assert.deepEqual(result, { branch: "main", head: HEAD, originHead: HEAD });
  assert.deepEqual(fake.calls[0], ["fetch", "origin", "main"]);
});

test("production source gate rejects a non-main branch", async () => {
  const fake = fakeGit({ branch: "feature/hardening" });

  await assert.rejects(
    () => assertProductionSourceRevision({ runGit: fake.runGit }),
    /current branch to be main/,
  );
});

test("production source gate rejects a local head that is not origin/main", async () => {
  const fake = fakeGit({ originHead: OTHER_HEAD });

  await assert.rejects(
    () => assertProductionSourceRevision({ runGit: fake.runGit }),
    /local HEAD to equal origin\/main/,
  );
});

test("production source gate fails closed when fetch fails", async () => {
  const fake = fakeGit({ fetchError: "remote credential text must not escape" });

  await assert.rejects(
    () => assertProductionSourceRevision({ runGit: fake.runGit }),
    /successful git fetch of origin\/main/,
  );
});
