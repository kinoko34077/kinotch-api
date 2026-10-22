// All supported production release modes use the SAME repository-remote lease.
// Git's expected-empty ref update is atomic across operator machines. A crash
// leaves the lease in place until a HUMAN verifies active Worker state.
import { randomUUID } from "node:crypto";

export const PRODUCTION_RELEASE_LOCK_REF = "refs/heads/ops/production-release-lock";
const SHA = /^[0-9a-f]{40}$/;
function isSha(value) { return typeof value === "string" && SHA.test(value); }

async function readLeaseRef(runGit, ref) {
  const output = (await runGit(["ls-remote", "origin", ref], {capture: true})).trim();
  if (!output) return null;
  const [sha, name] = output.split(/\s+/);
  if (!isSha(sha) || name !== ref) throw new Error("Production release lock reference is ambiguous");
  return sha;
}

export async function acquireProductionReleaseLock({runGit} = {}) {
  if (typeof runGit !== "function") throw new TypeError("Git command runner required");
  const head = (await runGit(["rev-parse", "HEAD"], {capture:true})).trim();
  const tree = (await runGit(["rev-parse", "HEAD^{tree}"], {capture:true})).trim();
  if (!isSha(head) || !isSha(tree)) throw new Error("Cannot resolve trusted source for release lease");
  // A unique parented local commit means even identical-release two operators
  // never silently succeed as "everything up to date".
  const marker = (await runGit([
    "-c", "user.name=Production Release Gate",
    "-c", "user.email=production-release@users.noreply.github.com",
    "commit-tree", tree, "-p", head,
    "-m", "exclusive production release [skip ci] " + randomUUID(),
  ], {capture:true})).trim();
  if (!isSha(marker)) throw new Error("Cannot construct unique release lease");
  const ref = PRODUCTION_RELEASE_LOCK_REF;
  try {
    // Empty expected SHA: only one concurrent operator may CREATE this ref.
    // Never force-update a currently held lease.
    await runGit(["push", "--porcelain", "--force-with-lease=" + ref + ":",
      "origin", marker + ":" + ref], {capture:true});
  } catch {
    // Network connection may fail after remote state changed; only continue if
    // exact unique marker was installed. Never delete a foreign actor's ref.
    if (await readLeaseRef(runGit, ref) !== marker) {
      throw new Error("Production release is locked or exclusive lease creation failed");
    }
  }
  if (await readLeaseRef(runGit, ref) !== marker) {
    throw new Error("Production release lease was not confirmed on origin");
  }
  return Object.freeze({ref, sha:marker});
}

export async function releaseProductionReleaseLock({runGit, lease} = {}) {
  if (typeof runGit !== "function" || lease?.ref !== PRODUCTION_RELEASE_LOCK_REF
    || !isSha(lease?.sha)) throw new Error("Cannot release an unverified production lease");
  const actual = await readLeaseRef(runGit, lease.ref);
  if (actual !== lease.sha) throw new Error("Production lease changed; manual release reconciliation required");
  try {
    // Delete only if the remote ref STILL equals exactly our marker SHA.
    await runGit(["push", "--porcelain", "--force-with-lease=" + lease.ref + ":" + lease.sha,
      "origin", ":" + lease.ref], {capture:true});
  } catch {
    // Ambiguous disconnect is allowed only when the ref is verifiably gone.
    if (await readLeaseRef(runGit, lease.ref) !== null) {
      throw new Error("Production release lock could not be released");
    }
  }
  if (await readLeaseRef(runGit, lease.ref) !== null) {
    throw new Error("Production release lock deletion could not be verified");
  }
}
