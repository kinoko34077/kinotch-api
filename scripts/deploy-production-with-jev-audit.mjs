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
import {
  MCP_RELEASE_CONFIG,
  MCP_RELEASE_WORKER_NAME,
  resolveMcpSmokeInputs,
} from "./mcp-release.mjs";
import { runMcpSmoke } from "./smoke-mcp.mjs";
import {
  PRODUCTION_SMOKE_TARGETS,
  runCompressionGatewayReadiness,
  runProductionSmoke,
} from "./smoke-production.mjs";
import { assertProductionSourceRevision } from "./production-source-gate.mjs";
import { createWranglerInvocation } from "./wrangler-runner.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, {
  capture = false,
  allowFailure = false,
  env = process.env,
  shell = false,
} = {}) {
  return new Promise((resolve, reject) => {
    let output = "";
    let errorOutput = "";
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: capture || allowFailure ? ["inherit", "pipe", "pipe"] : "inherit",
      shell,
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
  const invocation = createWranglerInvocation(args, { projectRoot });
  return run(invocation.command, invocation.args, {
    ...options,
    shell: invocation.shell,
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

async function getActiveTextVersionId() {
  const output = await runWrangler([
    "deployments",
    "status",
    "--name",
    "text-transform",
    "--json",
    "--config",
    "wrangler.text-transform.jsonc",
  ], { capture: true });
  return parseActiveVersionId(output, "Text Worker");
}

async function getActiveCompressionVersionId() {
  const output = await runWrangler([
    "deployments",
    "status",
    "--name",
    "semantic-compression",
    "--json",
    "--config",
    "wrangler.semantic-compression.jsonc",
  ], { capture: true });
  return parseActiveVersionId(output, "Compression Worker");
}

async function getActiveMcpVersionId() {
  const output = await runWrangler([
    "deployments",
    "status",
    "--name",
    MCP_RELEASE_WORKER_NAME,
    "--json",
    "--config",
    MCP_RELEASE_CONFIG,
  ], { capture: true });
  return parseActiveVersionId(output, "Compression MCP Worker");
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

async function runCompressionRecoverySmoke() {
  await runCompressionGatewayReadiness({ targets: PRODUCTION_SMOKE_TARGETS });
  return { status: "passed", mode: "non_billable_compression_readiness" };
}

async function runMcpRecoverySmoke() {
  await runMcpSmoke({ ...resolveMcpSmokeInputs(process.env), checkToolCall: false });
  return { status: "passed", mode: "non_billable_mcp_handshake" };
}

async function recoverCoreAfterJevFailure(previousCoreVersions) {
  const recoveries = {};
  const recoveryTargets = [
    {
      key: "compressionRecovery",
      previousVersionId: previousCoreVersions.previousCompressionVersionId,
      workerName: "semantic-compression",
      config: "wrangler.semantic-compression.jsonc",
      message: "automatic-jev-audit-compression-smoke-failure-rollback",
      getActiveVersionId: getActiveCompressionVersionId,
      recoverySmoke: runCompressionRecoverySmoke,
    },
    {
      key: "mcpRecovery",
      previousVersionId: previousCoreVersions.previousMcpVersionId,
      workerName: MCP_RELEASE_WORKER_NAME,
      config: MCP_RELEASE_CONFIG,
      message: "automatic-jev-audit-mcp-smoke-failure-rollback",
      getActiveVersionId: getActiveMcpVersionId,
      recoverySmoke: runMcpRecoverySmoke,
    },
    {
      key: "textRecovery",
      previousVersionId: previousCoreVersions.previousTextVersionId,
      workerName: "text-transform",
      config: "wrangler.text-transform.jsonc",
      message: "automatic-jev-audit-text-smoke-failure-rollback",
      getActiveVersionId: getActiveTextVersionId,
      recoverySmoke: runGatewayRecoverySmoke,
    },
  ];

  for (const target of recoveryTargets) {
    if (!target.previousVersionId) continue;
    try {
      recoveries[target.key] = await rollbackAfterSmokeFailure({
        previousVersionId: target.previousVersionId,
        rollback: async (versionId) => runWrangler(createWorkerRollbackArgs(
          versionId,
          target.message,
          { workerName: target.workerName, config: target.config },
        )),
        getActiveVersionId: target.getActiveVersionId,
        recoverySmoke: target.recoverySmoke,
      });
    } catch (rollbackError) {
      recoveries[target.key] = {
        status: "rollback_failed",
        targetVersionId: target.previousVersionId,
        error: rollbackError.message,
      };
    }
  }
  return recoveries;
}

async function runCoreProductionRelease() {
  return run(process.execPath, ["scripts/deploy-production.mjs"], {
    env: process.env,
    shell: false,
  });
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
  previousTextVersionId: null,
  previousCompressionVersionId: null,
  previousGatewayVersionId: null,
  previousMcpVersionId: null,
  coreReleaseCompleted: false,
  gatewayRecovery: null,
  coreRecovery: null,
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

  state.stage = "capture previous Text Worker version";
  state.previousTextVersionId = await getActiveTextVersionId();
  state.stage = "capture previous Compression Worker version";
  state.previousCompressionVersionId = await getActiveCompressionVersionId();
  state.stage = "capture previous Gateway version";
  state.previousGatewayVersionId = await getActiveGatewayVersionId();
  state.stage = "capture previous Compression MCP Worker version";
  state.previousMcpVersionId = await getActiveMcpVersionId();

  state.stage = "core production release";
  await runCoreProductionRelease();
  state.coreReleaseCompleted = true;

  state.stage = "Jev Audit post-core smoke";
  await phase.smoke();
  state.stage = "write Jev Audit release metadata";
  const releasePath = await writeJevAuditReleaseRecord({
    status: "succeeded",
    previousTextVersionId: state.previousTextVersionId,
    previousCompressionVersionId: state.previousCompressionVersionId,
    previousGatewayVersionId: state.previousGatewayVersionId,
    previousMcpVersionId: state.previousMcpVersionId,
    gatewayRecovery: state.gatewayRecovery,
    coreRecovery: state.coreRecovery,
    ...phase.metadata(),
  });
  console.log(`Jev Audit release metadata recorded at ${path.relative(projectRoot, releasePath)}`);
} catch (error) {
  const failureStage = state.stage;
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

  if (state.coreReleaseCompleted && !state.coreRecovery) {
    try {
      state.stage = "Jev Audit core Worker recovery";
      state.coreRecovery = await recoverCoreAfterJevFailure({
        previousTextVersionId: state.previousTextVersionId,
        previousCompressionVersionId: state.previousCompressionVersionId,
        previousMcpVersionId: state.previousMcpVersionId,
      });
    } catch (recoveryError) {
      state.coreRecovery = {
        status: "recovery_failed",
        error: recoveryError.message,
      };
    }
  }

  const recovery = await phase.recover();
  try {
    const releasePath = await writeJevAuditReleaseRecord({
      status: "failed",
      failure: { stage: failureStage, ...safeError(error) },
      previousTextVersionId: state.previousTextVersionId,
      previousCompressionVersionId: state.previousCompressionVersionId,
      previousGatewayVersionId: state.previousGatewayVersionId,
      previousMcpVersionId: state.previousMcpVersionId,
      gatewayRecovery: state.gatewayRecovery,
      coreRecovery: state.coreRecovery,
      ...phase.metadata(),
      ...recovery,
    });
    console.error(`Failed Jev Audit release metadata recorded at ${path.relative(projectRoot, releasePath)}`);
  } catch (recordError) {
    console.error(`Could not record failed Jev Audit release metadata: ${recordError.message}`);
  }
  throw error;
}
