// Executed ONLY through the existing deploy:production entrypoint.
// The security mode never invokes paid compression/audit tool calls.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createJevAuditMcpDeployArgs, JEV_AUDIT_MCP_CONFIG, JEV_AUDIT_MCP_ENDPOINT, JEV_AUDIT_MCP_WORKER_NAME } from "./jev-audit-release.mjs";
import { createMcpDeployArgs, MCP_RELEASE_CONFIG, MCP_RELEASE_ENDPOINT, MCP_RELEASE_WORKER_NAME, resolveMcpSmokeInputs } from "./mcp-release.mjs";
import { runJevAuditMcpSmoke } from "./smoke-jev-audit.mjs";
import { runMcpSmoke } from "./smoke-mcp.mjs";
import { assertProductionSourceRevision } from "./production-source-gate.mjs";
import { parseActiveVersionId, createWorkerRollbackArgs, rollbackAfterSmokeFailure } from "./release-recovery.mjs";
import { createReleaseChildEnv } from "./release-child-env.mjs";
import { createWranglerInvocation, createNpmInvocation } from "./wrangler-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SECURITY_MCP_WORKERS = Object.freeze([
  Object.freeze({ name: MCP_RELEASE_WORKER_NAME, config: MCP_RELEASE_CONFIG }),
  Object.freeze({ name: JEV_AUDIT_MCP_WORKER_NAME, config: JEV_AUDIT_MCP_CONFIG }),
]);

function safeFailure(error) {
  return { name: error?.name ?? "Error", message: error?.message ?? "unknown_error" };
}

export async function executeFeeFreeMcpRelease({
  prepare, dryRun, activeVersion, deploy, discoverySmoke, unauthenticatedSmoke, rollback, writeRecord,
} = {}) {
  for (const [name, fn] of Object.entries({prepare, dryRun, activeVersion, deploy, discoverySmoke, unauthenticatedSmoke, rollback, writeRecord})) {
    if (typeof fn !== "function") throw new TypeError("Security release requires " + name);
  }
  const previous = {};
  const updated = {};
  const potentiallyTouched = [];
  let revision;
  let stage = "prepare";
  try {
    revision = await prepare();
    for (const worker of SECURITY_MCP_WORKERS) {
      stage = "dry_run_" + worker.name;
      await dryRun(worker);
    }
    // Capture both rollback targets and verify both existing, authenticated
    // non-billable tool-discovery routes BEFORE performing any mutation.
    for (const worker of SECURITY_MCP_WORKERS) {
      stage = "snapshot_" + worker.name;
      previous[worker.name] = await activeVersion(worker);
    }
    for (const worker of SECURITY_MCP_WORKERS) {
      stage = "preflight_auth_" + worker.name;
      await discoverySmoke(worker);
      await unauthenticatedSmoke(worker);
    }
    for (const worker of SECURITY_MCP_WORKERS) {
      stage = "pre_deploy_compare_" + worker.name;
      if (await activeVersion(worker) !== previous[worker.name]) {
        throw new Error("Active " + worker.name + " changed during security release preflight");
      }
      // Register potential mutation before invocation, even if deploy reports
      // a network failure after Cloudflare actually changed the active code.
      potentiallyTouched.push(worker);
      stage = "deploy_" + worker.name;
      await deploy(worker);
      stage = "verify_version_" + worker.name;
      updated[worker.name] = await activeVersion(worker);
      if (updated[worker.name] === previous[worker.name]) {
        throw new Error("Security release did not activate a new " + worker.name + " version");
      }
    }
    for (const worker of SECURITY_MCP_WORKERS) {
      stage = "post_deploy_auth_" + worker.name;
      await discoverySmoke(worker);
      await unauthenticatedSmoke(worker);
      if (await activeVersion(worker) !== updated[worker.name]) {
        throw new Error("Active " + worker.name + " drifted after nonbillable validation");
      }
    }
    const record = {
      status: "succeeded", mode: "fee_free_mcp_security_only", sourceRevision: revision,
      previousVersions: previous, activeVersions: updated,
      validation: "authenticated_tool_discovery_and_unauthenticated_handshake_denial",
      providerToolCalls: 0,
    };
    stage = "record_success";
    await writeRecord(record);
    return record;
  } catch (error) {
    const failureStage = stage;
    const recoveries = {};
    for (const worker of potentiallyTouched.reverse()) {
      try {
        const actual = await activeVersion(worker);
        if (actual === previous[worker.name]) {
          recoveries[worker.name] = { status: "unchanged_or_already_recovered" };
        } else {
          recoveries[worker.name] = await rollback(worker, previous[worker.name]);
        }
      } catch (recoveryError) {
        recoveries[worker.name] = { status: "rollback_failed", error: safeFailure(recoveryError) };
      }
    }
    try {
      await writeRecord({
        status: "failed", mode: "fee_free_mcp_security_only", sourceRevision: revision ?? null,
        failure: { stage: failureStage, ...safeFailure(error) },
        previousVersions: previous, recoveries, providerToolCalls: 0,
      });
    } catch {
      // Preserve the original error; never disguise an unknown Cloudflare state.
    }
    if (Object.values(recoveries).some(v => v.status === "rollback_failed")) {
      throw new Error("Security MCP release failed and one or more Worker rollbacks are UNVERIFIED");
    }
    throw error;
  }
}

async function run(command, args, env, {capture = false} = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root, env, shell: false, stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let output = "";
    if (capture) child.stdout.on("data", data => { output += data; });
    child.once("error", reject);
    child.once("close", code => {
      if (code === 0) resolve(output);
      else reject(new Error("Security release child process exited unsuccessfully"));
    });
  });
}

const safeEnv = () => createReleaseChildEnv(process.env);
const cloudflareEnv = () => createReleaseChildEnv(process.env, { includeCloudflareCredentials: true });
async function git(args, options={}) {
  return run("git", args, safeEnv(), options);
}
async function wrangler(args, options={}) {
  const invocation = createWranglerInvocation(args, { projectRoot: root });
  return run(invocation.command, invocation.args, cloudflareEnv(), options);
}
async function npm(args) {
  const invocation = createNpmInvocation(args);
  return run(invocation.command, invocation.args, safeEnv());
}

function deployArgs(worker, dryRun=false) {
  if (worker.name === MCP_RELEASE_WORKER_NAME) {
    return createMcpDeployArgs({env: process.env, dryRun});
  }
  if (worker.name === JEV_AUDIT_MCP_WORKER_NAME) {
    return createJevAuditMcpDeployArgs({env: process.env, dryRun});
  }
  throw new Error("Unknown Worker in security release");
}
function discoveryInputs() {
  return resolveMcpSmokeInputs(process.env);
}
async function discoverySmoke(worker) {
  const {accessClientId, accessClientSecret} = discoveryInputs();
  const result = worker.name === MCP_RELEASE_WORKER_NAME
    ? await runMcpSmoke({ ...discoveryInputs(), checkToolCall: false })
    : await runJevAuditMcpSmoke({accessClientId, accessClientSecret, checkToolCall: false});
  if (result.status !== "passed" || (worker.name === JEV_AUDIT_MCP_WORKER_NAME && result.toolCall !== false)) {
    throw new Error("Nonbillable MCP discovery did not pass");
  }
}

async function activeVersion(worker) {
  const data = await wrangler(["deployments", "status", "--name", worker.name, "--json", "--config", worker.config], {capture:true});
  return parseActiveVersionId(data, worker.name);
}
async function writeRecord(record) {
  const folder = path.join(root, "docs", "releases");
  await mkdir(folder, {recursive: true});
  const timestamp = new Date().toISOString();
  const basename = "security-mcp-" + timestamp.replaceAll(/[-:.]/g, "") + ".json";
  await writeFile(path.join(folder, basename), JSON.stringify({recordedAtUtc:timestamp, ...record}, null, 2) + "\n", "utf8");
  console.log("Security MCP release result recorded: " + path.join("docs", "releases", basename));
}
export async function runFeeFreeMcpSecurityRelease() {
  return executeFeeFreeMcpRelease({
    async prepare() {
      const major = Number(process.versions.node.split(".")[0]);
      const [_, minor, patch] = process.versions.node.split(".").map(Number);
      if (major !== 26 || minor < 12 || (minor === 12 && patch < 1)) {
        throw new Error("Security MCP release requires patched Node >=26.12.1 <27");
      }
      const status = await git(["status","--porcelain"], {capture:true});
      if (status.trim()) throw new Error("Security MCP release requires a clean worktree");
      const source = await assertProductionSourceRevision({ runGit: async (args, opts) => git(args,opts) });
      await npm(["ci"]);
      await npm(["test"]);
      // Live source publication must independently recheck the current locked
      // production advisory set. A 503/timeout is DENIED, never "no findings".
      await npm(["audit", "--omit=dev", "--audit-level=high",
        "--fetch-timeout=30000", "--fetch-retries=1"]);
      const after = await git(["status","--porcelain"], {capture:true});
      if (after.trim()) throw new Error("Security MCP tests changed source worktree");
      const reread = await assertProductionSourceRevision({runGit:async(args,opts)=>git(args,opts)});
      if (reread.head !== source.head) throw new Error("Security MCP source changed during tests");
      return source.head;
    },
    async dryRun(worker) { await wrangler(deployArgs(worker,true)); },
    activeVersion,
    async deploy(worker) { await wrangler(deployArgs(worker,false)); },
    discoverySmoke,
    async unauthenticatedSmoke(worker) {
      const endpoint = worker.name === MCP_RELEASE_WORKER_NAME
        ? MCP_RELEASE_ENDPOINT : JEV_AUDIT_MCP_ENDPOINT;
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-06-18",
        },
        body: JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",
          params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"security-audit",version:"1"}}}),
        signal: AbortSignal.timeout(12000),
      });
      if (![301,302,303,307,308,401,403].includes(response.status)) {
        throw new Error("Unauthenticated public MCP initialization did not fail closed");
      }
    },
    async rollback(worker, previousVersionId) {
      return rollbackAfterSmokeFailure({
        previousVersionId,
        rollback: version => wrangler(createWorkerRollbackArgs(
          version, "security-mcp-nonbillable-validation-failed", {workerName:worker.name,config:worker.config},
        )),
        getActiveVersionId: () => activeVersion(worker),
        recoverySmoke: async () => {
          await discoverySmoke(worker);
          return { status:"passed", mode:"non_billable_mcp_discovery" };
        },
      });
    },
    writeRecord,
  });
}
