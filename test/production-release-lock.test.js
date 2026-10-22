import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { acquireProductionReleaseLock, releaseProductionReleaseLock,
  PRODUCTION_RELEASE_LOCK_REF } from "../scripts/production-release-lock.mjs";

const execFileAsync = promisify(execFile);
const git = (cwd, args) => execFileAsync("git", args, {cwd});

async function withBareRemote(fn) {
  const dir = await mkdtemp(join(tmpdir(), "release-lease-"));
  const remote = join(dir, "remote.git");
  const work = join(dir, "source");
  try {
    await git(dir, ["init", "--bare", remote]);
    await git(dir, ["init", work]);
    await git(work, ["config", "user.name", "Test Worker"]);
    await git(work, ["config", "user.email", "test@example.invalid"]);
    await writeFile(join(work, "README.md"), "test only\n");
    await git(work, ["add", "README.md"]);
    await git(work, ["commit", "-m", "fixture"]);
    await git(work, ["remote", "add", "origin", remote]);
    await git(work, ["push", "origin", "HEAD:refs/heads/main"]);
    const runGit = async(args) => (await git(work, args)).stdout;
    await fn({runGit, remote, work});
  } finally {
    await rm(dir, {recursive:true,force:true});
  }
}

test("production lease is a single atomically-created remote ref for both modes", async() => {
  await withBareRemote(async({runGit}) => {
    const [first, second] = await Promise.allSettled([
      acquireProductionReleaseLock({runGit}),
      acquireProductionReleaseLock({runGit}),
    ]);
    const successes = [first, second].filter(x=>x.status==="fulfilled");
    assert.equal(successes.length, 1, "concurrent releases must never both acquire");
    const lease=successes[0].value;
    assert.equal(lease.ref, PRODUCTION_RELEASE_LOCK_REF);
    const markerMessage=(await runGit(["show","-s","--format=%B",lease.sha])).trim();
    assert.match(markerMessage,/\[skip ci\]/,"lease-only commit must not spend GitHub Actions minutes");
    assert.match(lease.sha, /^[a-f0-9]{40}$/);
    const blocked=[first,second].filter(x=>x.status==="rejected");
    assert.equal(blocked.length,1);
    assert.match(blocked[0].reason.message, /locked|lease/i);
    const held=(await runGit(["ls-remote","origin",PRODUCTION_RELEASE_LOCK_REF])).trim();
    assert.ok(held.startsWith(lease.sha));
    await releaseProductionReleaseLock({runGit,lease});
    assert.equal((await runGit(["ls-remote","origin",PRODUCTION_RELEASE_LOCK_REF])).trim(), "");
    const next=await acquireProductionReleaseLock({runGit});
    assert.notEqual(next.sha,lease.sha);
    await releaseProductionReleaseLock({runGit,lease:next});
  });
});

test("production lease never overwrites or releases a foreign version",async()=>{
  await withBareRemote(async({runGit,remote,work})=>{
    const lease=await acquireProductionReleaseLock({runGit});
    const baseline=(await runGit(["rev-parse","HEAD"])).trim();
    await git(remote,["update-ref",PRODUCTION_RELEASE_LOCK_REF,baseline]);
    await assert.rejects(releaseProductionReleaseLock({runGit,lease}),/changed|reconciliation/);
    const actual=(await runGit(["ls-remote","origin",PRODUCTION_RELEASE_LOCK_REF])).trim();
    assert.ok(actual.startsWith(baseline), "changed lease must be untouched");
    await assert.rejects(acquireProductionReleaseLock({runGit}),/locked|lease/);
    await git(remote,["update-ref","-d",PRODUCTION_RELEASE_LOCK_REF]);
  });
});

test("lease marker does not alter checkout source, index or working tree",async()=>{
  await withBareRemote(async({runGit})=>{
    const before=(await runGit(["status","--porcelain"])).trim();
    const source=(await runGit(["rev-parse","HEAD"])).trim();
    const lease=await acquireProductionReleaseLock({runGit});
    assert.equal((await runGit(["status","--porcelain"])).trim(), before);
    assert.equal((await runGit(["rev-parse","HEAD"])).trim(), source);
    await releaseProductionReleaseLock({runGit,lease});
  });
});
