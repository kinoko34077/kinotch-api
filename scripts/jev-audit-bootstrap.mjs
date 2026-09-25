import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createReleaseChildEnv } from "./release-child-env.mjs";
import {
  isMissingWorkerDeploymentError,
  parseOptionalActiveVersionId,
} from "./release-recovery.mjs";
import { assertProductionSourceRevision } from "./production-source-gate.mjs";
import {
  JEV_AUDIT_MCP_CONFIG,
  JEV_AUDIT_MCP_WORKER_NAME,
  JEV_AUDIT_PRIVATE_CONFIG,
  JEV_AUDIT_PRIVATE_WORKER_NAME,
} from "./jev-audit-release.mjs";

export const JEV_AUDIT_BOOTSTRAP_CONFIRMATION = "JEV_AUDIT_BOOTSTRAP_CONFIRM";
export const JEV_AUDIT_BOOTSTRAP_PRIVATE_CONFIG = JEV_AUDIT_PRIVATE_CONFIG;
export const JEV_AUDIT_BOOTSTRAP_MCP_CONFIG = JEV_AUDIT_MCP_CONFIG;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

export function assertJevAuditBootstrapConfirmation(env = process.env) {
  if (env?.[JEV_AUDIT_BOOTSTRAP_CONFIRMATION] !== "true") {
    throw new Error("Jev Audit bootstrap requires JEV_AUDIT_BOOTSTRAP_CONFIRM=true");
  }
}

export function createJevAuditBootstrapDeployArgs(config, { dryRun = false } = {}) {
  if (![JEV_AUDIT_BOOTSTRAP_PRIVATE_CONFIG, JEV_AUDIT_BOOTSTRAP_MCP_CONFIG].includes(config)) {
    throw new Error("Unsupported Jev Audit bootstrap config");
  }
  return ["wrangler", "deploy", "--config", config, ...(dryRun ? ["--dry-run"] : [])];
}

export function resolveJevAuditBootstrapState({ privateVersionId, mcpVersionId }) {
  if (!privateVersionId && mcpVersionId) {
    throw new Error("Jev Audit MCP Worker exists without the private Worker");
  }
  if (privateVersionId && mcpVersionId) {
    throw new Error("Jev Audit bootstrap is only allowed before the initial Jev Audit Worker bootstrap is complete");
  }
  return {
    deployPrivate: !privateVersionId,
    deployMcp: !mcpVersionId,
  };
}

function run(command, args, {
  capture = false,
  allowFailure = false,
  env = process.env,
} = {}) {
  return new Promise((resolve, reject) => {
    let output = "";
    let errorOutput = "";
    const collect = capture || allowFailure;
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: collect ? ["inherit", "pipe", "pipe"] : "inherit",
      shell: process.platform === "win32",
    });
    if (collect) {
      child.stdout.on("data", (chunk) => {
        output += chunk;
        process.stdout.write(chunk);
      });
      child.stderr.on("data", (chunk) => {
        errorOutput += chunk;
        process.stderr.write(chunk);
      });
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (allowFailure) return resolve({ code, signal, output, errorOutput });
      if (code === 0) return resolve(capture ? output : undefined);
      reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? code}`));
    });
  });
}

function runGit(args, options = {}) {
  return run("git", [
    "-c",
    `safe.directory=${projectRoot.replaceAll("\\", "/")}`,
    ...args,
  ], options);
}

function cloudflareEnv() {
  return createReleaseChildEnv(process.env, { includeCloudflareCredentials: true });
}

async function assertCleanWorktree() {
  const output = await runGit(["status", "--porcelain"], { capture: true });
  if (output.trim()) throw new Error("Jev Audit bootstrap requires a clean Git worktree");
}

async function getActiveVersionId(workerName, config) {
  const result = await run(npxCommand, [
    "wrangler",
    "deployments",
    "status",
    "--name",
    workerName,
    "--json",
    "--config",
    config,
  ], { capture: true, allowFailure: true, env: cloudflareEnv() });
  if (result.code !== 0) {
    const diagnostic = `${result.output ?? ""}\n${result.errorOutput ?? ""}`;
    if (isMissingWorkerDeploymentError(diagnostic)) return null;
    throw new Error(`Could not determine ${workerName} deployment state`);
  }
  return parseOptionalActiveVersionId(result.output, workerName);
}

function parseDeployVersionId(output, workerName) {
  const value = String(output ?? "").match(/Current Version ID:\s*([0-9a-f-]{36})/i)?.[1];
  if (!value) throw new Error(`Could not read the ${workerName} Version ID from Wrangler output`);
  return value;
}

async function deployWorker(workerName, config) {
  await run(npxCommand, createJevAuditBootstrapDeployArgs(config, { dryRun: true }), {
    env: cloudflareEnv(),
  });
  const output = await run(npxCommand, createJevAuditBootstrapDeployArgs(config), {
    capture: true,
    env: cloudflareEnv(),
  });
  return parseDeployVersionId(output, workerName);
}

export async function main() {
  assertJevAuditBootstrapConfirmation(process.env);
  await assertCleanWorktree();
  const sourceRevision = await assertProductionSourceRevision({ runGit });

  let privateVersionId = await getActiveVersionId(
    JEV_AUDIT_PRIVATE_WORKER_NAME,
    JEV_AUDIT_BOOTSTRAP_PRIVATE_CONFIG,
  );
  let mcpVersionId = await getActiveVersionId(
    JEV_AUDIT_MCP_WORKER_NAME,
    JEV_AUDIT_BOOTSTRAP_MCP_CONFIG,
  );
  const state = resolveJevAuditBootstrapState({ privateVersionId, mcpVersionId });

  await run(npmCommand, ["test"], {
    env: createReleaseChildEnv(process.env),
  });

  if (state.deployPrivate) {
    privateVersionId = await deployWorker(
      JEV_AUDIT_PRIVATE_WORKER_NAME,
      JEV_AUDIT_BOOTSTRAP_PRIVATE_CONFIG,
    );
  }
  if (state.deployMcp) {
    mcpVersionId = await deployWorker(
      JEV_AUDIT_MCP_WORKER_NAME,
      JEV_AUDIT_BOOTSTRAP_MCP_CONFIG,
    );
  }

  console.log(JSON.stringify({
    status: state.deployPrivate ? "bootstrap_deployed" : "bootstrap_resumed",
    gitRevision: sourceRevision.head,
    privateVersionId,
    mcpVersionId,
    next: [
      "Configure TYPESAFE_API_KEY as a Secret on the private jev-audit Worker.",
      "Configure JEV_AUDIT_API_TOKEN as a Secret on the existing api Gateway and keep the same value only in the opaque local JEV_AUDIT_SMOKE_TOKEN release input.",
      "Create the Cloudflare Access application for jev-audit-mcp, enable Managed OAuth, and allow the existing release Service Token through a Service Auth policy.",
      "Record the Jev Audit Access Audience as JEV_AUDIT_MCP_POLICY_AUD in the opaque local production inputs, then run npm run release:local.",
    ],
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
