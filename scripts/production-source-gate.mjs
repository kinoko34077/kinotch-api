const SHA_PATTERN = /^[a-f0-9]{40}$/;

export async function assertProductionSourceRevision({ runGit, expectedBranch = "main" } = {}) {
  if (typeof runGit !== "function") {
    throw new Error("Production release source gate requires a Git command runner");
  }

  try {
    await runGit(["fetch", "origin", "main"]);
  } catch {
    throw new Error("Production release requires a successful git fetch of origin/main");
  }

  let branch;
  let head;
  let originHead;
  try {
    branch = (await runGit(["branch", "--show-current"], { capture: true })).trim();
    head = (await runGit(["rev-parse", "HEAD"], { capture: true })).trim();
    originHead = (await runGit(["rev-parse", "origin/main"], { capture: true })).trim();
  } catch {
    throw new Error("Production release could not determine the Git source revision");
  }

  if (branch !== expectedBranch) {
    throw new Error(`Production release requires the current branch to be ${expectedBranch}`);
  }
  if (!SHA_PATTERN.test(head) || !SHA_PATTERN.test(originHead)) {
    throw new Error("Production release requires valid local and origin/main revisions");
  }
  if (head !== originHead) {
    throw new Error("Production release requires local HEAD to equal origin/main");
  }

  return { branch, head, originHead };
}
