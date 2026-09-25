import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createJevAuditProductionPhase } from "./jev-audit-production-phase.mjs";
import { createReleaseChildEnv } from "./release-child-env.mjs";
import {
  createWorkerRollbackArgs,
  parseActiveVersionId,
  rollbackAfterSmokeFailure,
} from "./release-recovery.mjs";
import { PRODUCTION_SMOKE_TARGETS, runProductionSmoke } from "./smoke-production.mjs";
import { assertProductionSourceRevision } from "./production-source-gate.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, args, {
  capture = false,
  allowFailure = false,
  env = process.env,
} = {}) {
  return new Promise((resolve, reject) => {
    let output = "";
    let errorOutput = "";
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: capture || allowFailure ? ["inherit", "pipe", "pipe"] : "inherit",
      shell: process.platform === "win32",
    });
    if (capture || allowFailure) {
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
  return run("git", args, options);
}

async function assertCleanWorktree() {
  const status = await runGit(["status", "--porcelain"], { capture: true });
  if (status.trim()) {
    throw new Error("Jev Audit production release requires a clean worktree before deployment");
  }
}

function runWrangler(args, options = {}) {
  const normalizedArgs = args[0] === "wrangler" ? args.slice(1) : args;
  return run(npxCommand, ["wrangler", ...normalizedArgs], {
    ...options,
    env: createReleaseChildEnv(process.env, { includeCloudflareCredentials: true }),
  });
}

async function getActiveGatewayVersionId() {
  const output = await runWrangler([
    "deployments",
    "status",
    "--name",
    "api",
    "--json",
    "--config",
    "wrangler.jsonc",
  ], { capture: true });
  return parseActiveVersionId(output, "Gateway");
}

async function runGatewayRecoverySmoke() {
  await runProductionSmoke({
    targets: PRODUCTION_SMOKE_TARGETS,
    checkDirect: true,
    checkCompression: false,
  });
  return { status: "passed", mode: "non_billable_gateway_smoke" };
}

async function recoverGatewayAfterJevFailure(previousGatewayVersionId) {
  return rollbackAfterSmokeFailure({
    previousVersionId: previousGatewayVersionId,
    rollback: async (versionId) => runWrangler(createWorkerRollbackArgs(
      versionId,
      "automatic-jev-audit-gateway-smoke-failure-rollback",
      { workerName: "api", config: "wrangler.jsonc" },
    )),
    getActiveVersionId: getActiveGatewayVersionId,
    recoverySmoke: runGatewayRecoverySmoke,
  });
}

async function runCoreProductionRelease() {
  return run(process.execPath, ["scripts/deploy-production.mjs"], { env: process.env });
}

function safeError(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? "unknown error",
  };
}

async function writeJevAuditReleaseRecord(record) {
  const releasesDirectory = path.join(projectRoot, "docs", "releases");
  await mkdir(releasesDirectory, { recursive: true });
  const timestamp = new Date().toISOString();
  const fileName = `jev-audit-${timestamp.replaceAll(/[-:.]/g, "").replace(/Z$/, "Z")}.json`;
  const filePath = path.join(releasesDirectory, fileName);
  await writeFile(filePath, `${JSON.stringify({ recordedAtUtc: timestamp, ...record }, null, 2)}\n`, "utf8");
  return filePath;
}

const state = {
  stage: "Jev Audit preflight",
  previousGatewayVersionId: null,
  coreReleaseCompleted: false,
  gatewayRecovery: null,
};
const phase = createJevAuditProductionPhase({
  runWrangler,
  env: process.env,
  projectRoot,
  onStage: (stage) => {
    state.stage = stage;
    console.log(`[jev-audit release] ${stage}`);
  },
});

try {
  state.stage = "Jev Audit clean worktree assertion";
  await assertCleanWorktree();
  state.stage = "Jev Audit production source revision assertion";
  await assertProductionSourceRevision({ runGit });

  await phase.prepare();
  await phase.deploy();

  state.stage = "capture previous Gateway version";
  state.previousGatewayVersionId = await getActiveGatewayVersionId();

  state.stage = "core production release";
  await runCoreProductionRelease();
  state.coreReleaseCompleted = true;

  state.stage = "Jev Audit post-core smoke";
  await phase.smoke();
  state.stage = "write Jev Audit release metadata";
  const releasePath = await writeJevAuditReleaseRecord({
    status: "succeeded",
    previousGatewayVersionId: state.previousGatewayVersionId,
    gatewayRecovery: state.gatewayRecovery,
    ...phase.metadata(),
  });
  console.log(`Jev Audit release metadata recorded at ${path.relative(projectRoot, releasePath)}`);
} catch (error) {
  if (state.coreReleaseCompleted && state.previousGatewayVersionId && !state.gatewayRecovery) {
    try {
      state.stage = "Jev Audit Gateway recovery";
      state.gatewayRecovery = await recoverGatewayAfterJevFailure(state.previousGatewayVersionId);
    } catch (rollbackError) {
      state.gatewayRecovery = {
        status: "rollback_failed",
        targetVersionId: state.previousGatewayVersionId,
        error: rollbackError.message,
      };
    }
  }

  const recovery = await phase.recover();
  try {
    const releasePath = await writeJevAuditReleaseRecord({
      status: "failed",
      failure: { stage: state.stage, ...safeError(error) },
      previousGatewayVersionId: state.previousGatewayVersionId,
      gatewayRecovery: state.gatewayRecovery,
      ...phase.metadata(),
      ...recovery,
    });
    console.error(`Failed Jev Audit release metadata recorded at ${path.relative(projectRoot, releasePath)}`);
  } catch (recordError) {
    console.error(`Could not record failed Jev Audit release metadata: ${recordError.message}`);
  }
  throw error;
}
