import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import JSON5 from "json5";
import { assertPrivateTextWorkerConfig, assertPrivateWorkerConfig } from "./deploy-guards.mjs";
import {
  createRollbackArgs,
  createWorkerRollbackArgs,
  isMissingWorkerDeploymentError,
  parseActiveVersionId,
  parseOptionalActiveVersionId,
  rollbackAfterSmokeFailure,
} from "./release-recovery.mjs";
import {
  PRODUCTION_SMOKE_TARGETS,
  runCompressionGatewayReadiness,
  runCompressionSmoke,
  runProductionSmoke,
} from "./smoke-production.mjs";
import {
  COMPRESSION_MODEL,
  COMPRESSION_PROFILE_COMPACT,
  COMPRESSION_PROFILE_SEMANTIC_DENSE,
  COMPRESSION_PROMPT_VERSION,
  COMPRESSION_PROMPT_VERSION_COMPACT,
  COMPRESSION_PROMPT_VERSION_SEMANTIC_DENSE,
} from "../src/semantic-compression/contract.js";
import {
  buildMcpReleaseMetadata,
  createMcpDeployArgs,
  MCP_RELEASE_CONFIG,
  MCP_RELEASE_WORKER_NAME,
  resolveMcpSmokeInputs,
  resolveMcpSmokeState,
} from "./mcp-release.mjs";
import { runMcpSmoke } from "./smoke-mcp.mjs";
import { assertProductionSourceRevision } from "./production-source-gate.mjs";
import { createReleaseChildEnv } from "./release-child-env.mjs";
import { deployWithReconciliation } from "./release-deploy.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, args, {
  capture = false,
  allowFailure = false,
  env = createReleaseChildEnv(),
} = {}) {
  return new Promise((resolve, reject) => {
    let output = "";
    let errorOutput = "";
    const collectOutput = capture || allowFailure;
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: collectOutput ? ["inherit", "pipe", allowFailure ? "pipe" : "inherit"] : "inherit",
      shell: process.platform === "win32",
    });
    if (collectOutput) {
      child.stdout.on("data", (chunk) => {
        output += chunk;
        process.stdout.write(chunk);
      });
    }
    if (allowFailure) {
      child.stderr.on("data", (chunk) => {
        errorOutput += chunk;
        process.stderr.write(chunk);
      });
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (allowFailure) {
        resolve({ output, errorOutput, code, signal });
      } else if (code === 0) {
        resolve(capture ? output : undefined);
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? code}`));
      }
    });
  });
}

function runWrangler(args, options = {}) {
  const normalizedArgs = args[0] === "wrangler" ? args.slice(1) : args;
  return run(npxCommand, ["wrangler", ...normalizedArgs], {
    ...options,
    env: createReleaseChildEnv(process.env, { includeCloudflareCredentials: true }),
  });
}

function getVersionId(output, workerName) {
  const versionId = output.match(/Current Version ID:\s*([0-9a-f-]{36})/i)?.[1];
  if (!versionId) throw new Error(`Could not read the ${workerName} Version ID from Wrangler output`);
  return versionId;
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
  return parseActiveVersionId(output);
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

async function getActiveCompressionVersionId() {
  const result = await runWrangler([
    "deployments",
    "status",
    "--name",
    "semantic-compression",
    "--json",
    "--config",
    "wrangler.semantic-compression.jsonc",
  ], { capture: true, allowFailure: true });
  if (result.code !== 0) {
    const diagnostic = `${result.output}\n${result.errorOutput}`;
    if (isMissingWorkerDeploymentError(diagnostic)) return null;
    throw new Error(`Could not read the Compression Worker deployment status (exit ${result.signal ?? result.code})`);
  }
  return parseOptionalActiveVersionId(result.output, "Compression Worker");
}

async function getActiveMcpVersionId() {
  const result = await runWrangler([
    "deployments",
    "status",
    "--name",
    MCP_RELEASE_WORKER_NAME,
    "--json",
    "--config",
    MCP_RELEASE_CONFIG,
  ], { capture: true, allowFailure: true });
  if (result.code !== 0) {
    const diagnostic = `${result.output}\n${result.errorOutput}`;
    if (isMissingWorkerDeploymentError(diagnostic)) return null;
    throw new Error(`Could not read the MCP Worker deployment status (exit ${result.signal ?? result.code})`);
  }
  return parseOptionalActiveVersionId(result.output, "MCP Worker");
}

async function assertCleanWorktree() {
  const output = await runGit([
    "status",
    "--porcelain",
  ], { capture: true });
  if (output.trim() !== "") {
    throw new Error("Production release requires a clean Git worktree");
  }
}

async function assertBuildDidNotChangeTrackedFiles() {
  await runGit([
    "diff",
    "--exit-code",
    "--",
  ]);
  await assertCleanWorktree();
}

function runGit(args, options = {}) {
  return run("git", [
    "-c",
    `safe.directory=${projectRoot.replaceAll("\\", "/")}`,
    ...args,
  ], options);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// A successful Gateway method check does not prove that its Service Binding
// subrequest path has switched to the newly deployed target Worker yet.
export const COMPRESSION_BINDING_PROPAGATION_SETTLE_MS = 30_000;

async function runSmokeWithRetry(options, attempts = 12) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runProductionSmoke(options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.warn(`Production smoke attempt ${attempt}/${attempts} failed; retrying after propagation wait`);
        await wait(5_000);
      }
    }
  }
  throw lastError;
}

async function runCompressionGatewayReadinessWithRetry(options, attempts = 12) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const readiness = await runCompressionGatewayReadiness(options);
      console.log(`Compression Gateway readiness passed; waiting ${COMPRESSION_BINDING_PROPAGATION_SETTLE_MS}ms for Service Binding propagation`);
      await wait(COMPRESSION_BINDING_PROPAGATION_SETTLE_MS);
      return readiness;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.warn(`Compression Gateway readiness attempt ${attempt}/${attempts} failed; retrying after propagation wait`);
        await wait(5_000);
      }
    }
  }
  throw lastError;
}

async function runGatewayRecoverySmoke() {
  await runProductionSmoke({
    targets: PRODUCTION_SMOKE_TARGETS,
    checkDirect: true,
    checkCompression: false,
  });
  return { status: "passed", mode: "non_billable_gateway_smoke" };
}

async function runCompressionRecoverySmoke() {
  await runCompressionGatewayReadiness({ targets: PRODUCTION_SMOKE_TARGETS });
  return { status: "passed", mode: "non_billable_compression_readiness" };
}

async function runMcpRecoverySmoke(mcpSmokeInputs) {
  if (!mcpSmokeInputs) throw new Error("MCP recovery smoke inputs are unavailable");
  await runMcpSmoke({ ...mcpSmokeInputs, checkToolCall: false });
  return { status: "passed", mode: "non_billable_mcp_handshake" };
}

function summarizeDeploymentResult(result) {
  return {
    status: result.status,
    versionId: result.versionId ?? null,
    needsRollback: result.needsRollback === true,
  };
}

function releaseTimestamp() {
  const recordedAt = new Date();
  return {
    recordedAt,
    recordedAtUtc: recordedAt.toISOString(),
    recordedAtJst: new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Tokyo",
      dateStyle: "short",
      timeStyle: "medium",
    }).format(recordedAt),
  };
}

async function writeReleaseRecord(record) {
  const releasesDirectory = path.join(projectRoot, "docs", "releases");
  await mkdir(releasesDirectory, { recursive: true });
  const timestamp = releaseTimestamp();
  const releasePath = path.join(
    releasesDirectory,
    `${timestamp.recordedAt.toISOString().replaceAll(/[-:.]/g, "").replace(/Z$/, "Z")}.json`,
  );
  const { recordedAt: _recordedAt, ...recordedTimestamp } = timestamp;
  await writeFile(
    releasePath,
    `${JSON.stringify({ ...recordedTimestamp, ...record }, null, 2)}\n`,
    "utf8",
  );
  return releasePath;
}

async function main() {
  const state = {
    stage: "source revision",
    gitRevision: "unknown",
    previousTextVersionId: null,
    previousCompressionVersionId: null,
    previousMcpVersionId: null,
    previousGatewayVersionId: null,
    textVersionId: null,
    compressionVersionId: null,
    mcpVersionId: null,
    mcpEndpoint: null,
    gatewayVersionId: null,
    textSmoke: null,
    compressionSmoke: null,
    mcpSmoke: null,
    mcpOAuthSmoke: {
      status: "operator_required",
      reason: "Codex Managed OAuth client flow must be verified separately",
    },
    gatewaySmoke: null,
    textRecovery: null,
    compressionRecovery: null,
    mcpRecovery: null,
    gatewayRecovery: null,
    textDeployment: null,
    compressionDeployment: null,
    mcpDeployment: null,
    gatewayDeployment: null,
    textDeployed: false,
    textSmokeCompleted: false,
    compressionDeployed: false,
    mcpDeployed: false,
    compressionSmokeCompleted: false,
    gatewayDeployed: false,
    gatewaySmokeCompleted: false,
  };
  let mcpSmokeInputs = null;

  try {
    state.stage = "clean worktree assertion";
    await assertCleanWorktree();
    state.stage = "production source revision assertion";
    const sourceRevision = await assertProductionSourceRevision({ runGit });
    state.gitRevision = sourceRevision.head;

    state.stage = "private Worker config assertion";
    const textWorkerConfig = JSON5.parse(await readFile(
      path.join(projectRoot, "wrangler.text-transform.jsonc"),
      "utf8",
    ));
    assertPrivateTextWorkerConfig(textWorkerConfig);
    const compressionWorkerConfig = JSON5.parse(await readFile(
      path.join(projectRoot, "wrangler.semantic-compression.jsonc"),
      "utf8",
    ));
    assertPrivateWorkerConfig(compressionWorkerConfig, "semantic-compression");

    state.stage = "MCP Access configuration assertion";
    mcpSmokeInputs = resolveMcpSmokeInputs(process.env);
    state.mcpEndpoint = mcpSmokeInputs.endpoint;

    if (typeof process.env.COMPRESSION_SMOKE_TOKEN !== "string" || process.env.COMPRESSION_SMOKE_TOKEN.length === 0) {
      throw new Error("Compression smoke requires COMPRESSION_SMOKE_TOKEN");
    }

    state.stage = "clean dependency install";
    await run(npmCommand, ["ci"]);
    state.stage = "build snapshot";
    await run(npmCommand, ["run", "build:text-snapshot"]);
    state.stage = "generated file stability assertion";
    await assertBuildDidNotChangeTrackedFiles();
    state.stage = "snapshot checks";
    await run(npmCommand, ["run", "check:text-snapshot"]);
    state.stage = "test suite";
    await run(npmCommand, ["test"]);
    state.stage = "Text Worker dry-run";
    await runWrangler([
      "deploy",
      "--config",
      "wrangler.text-transform.jsonc",
      "--dry-run",
      "--var",
      `TEXT_CORE_SOURCE_REVISION:${state.gitRevision}`,
    ]);
    state.stage = "Compression Worker dry-run";
    await runWrangler([
      "deploy",
      "--config",
      "wrangler.semantic-compression.jsonc",
      "--dry-run",
    ]);
    state.stage = "MCP Worker dry-run";
    await runWrangler(createMcpDeployArgs({ env: process.env, dryRun: true }));
    state.stage = "Gateway dry-run";
    await runWrangler(["deploy", "--config", "wrangler.jsonc", "--dry-run"]);

    state.stage = "capture previous Text Worker version";
    state.previousTextVersionId = await getActiveTextVersionId();
    state.stage = "capture previous Gateway version";
    state.previousGatewayVersionId = await getActiveGatewayVersionId();
    state.stage = "capture previous Compression Worker version";
    state.previousCompressionVersionId = await getActiveCompressionVersionId();
    state.stage = "capture previous MCP Worker version";
    state.previousMcpVersionId = await getActiveMcpVersionId();

    state.stage = "Text Worker deploy";
    const textDeployment = await deployWithReconciliation({
      deploy: () => runWrangler(
        [
          "deploy",
          "--config",
          "wrangler.text-transform.jsonc",
          "--var",
          `TEXT_CORE_SOURCE_REVISION:${state.gitRevision}`,
        ],
        { capture: true },
      ),
      parseVersionId: (output) => getVersionId(output, "text-transform"),
      getActiveVersionId: getActiveTextVersionId,
      previousVersionId: state.previousTextVersionId,
    });
    state.textDeployment = summarizeDeploymentResult(textDeployment);
    state.textDeployed = textDeployment.deployed;
    state.textVersionId = textDeployment.versionId;
    if (textDeployment.error) throw textDeployment.error;

    state.stage = "Text Worker smoke";
    state.textSmoke = await runSmokeWithRetry({
      targets: PRODUCTION_SMOKE_TARGETS,
      checkDirect: true,
      checkGuards: false,
      checkCompression: false,
      expectedSourceRevision: state.gitRevision,
    });
    state.textSmokeCompleted = true;

    state.stage = "Compression Worker deploy";
    const compressionDeployment = await deployWithReconciliation({
      deploy: () => runWrangler(
        [
          "deploy",
          "--config",
          "wrangler.semantic-compression.jsonc",
        ],
        { capture: true },
      ),
      parseVersionId: (output) => getVersionId(output, "semantic-compression"),
      getActiveVersionId: getActiveCompressionVersionId,
      previousVersionId: state.previousCompressionVersionId,
    });
    state.compressionDeployment = summarizeDeploymentResult(compressionDeployment);
    state.compressionDeployed = compressionDeployment.deployed;
    state.compressionVersionId = compressionDeployment.versionId;
    if (compressionDeployment.error) throw compressionDeployment.error;

    state.stage = "MCP Worker deploy";
    const mcpDeployment = await deployWithReconciliation({
      deploy: () => runWrangler(
        createMcpDeployArgs({ env: process.env }),
        { capture: true },
      ),
      parseVersionId: (output) => getVersionId(output, "semantic-compression-mcp"),
      getActiveVersionId: getActiveMcpVersionId,
      previousVersionId: state.previousMcpVersionId,
    });
    state.mcpDeployment = summarizeDeploymentResult(mcpDeployment);
    state.mcpDeployed = mcpDeployment.deployed;
    state.mcpVersionId = mcpDeployment.versionId;
    if (mcpDeployment.error) throw mcpDeployment.error;
    state.stage = "MCP Access session-cookie smoke";
    state.mcpSmoke = await runMcpSmoke(mcpSmokeInputs);

    state.stage = "Gateway deploy";
    const gatewayDeployment = await deployWithReconciliation({
      deploy: () => runWrangler(
        ["deploy", "--config", "wrangler.jsonc"],
        { capture: true },
      ),
      parseVersionId: (output) => getVersionId(output, "api"),
      getActiveVersionId: getActiveGatewayVersionId,
      previousVersionId: state.previousGatewayVersionId,
    });
    state.gatewayDeployment = summarizeDeploymentResult(gatewayDeployment);
    state.gatewayDeployed = gatewayDeployment.deployed;
    state.gatewayVersionId = gatewayDeployment.versionId;
    if (gatewayDeployment.error) throw gatewayDeployment.error;

    state.stage = "Compression Gateway readiness";
    await runCompressionGatewayReadinessWithRetry({ targets: PRODUCTION_SMOKE_TARGETS });

    state.stage = "Compression smoke";
    state.compressionSmoke = {
          compact: await runCompressionSmoke({
            targets: PRODUCTION_SMOKE_TARGETS,
            token: process.env.COMPRESSION_SMOKE_TOKEN,
        profile: COMPRESSION_PROFILE_COMPACT,
      }),
          semanticDense: await runCompressionSmoke({
            targets: PRODUCTION_SMOKE_TARGETS,
            token: process.env.COMPRESSION_SMOKE_TOKEN,
        profile: COMPRESSION_PROFILE_SEMANTIC_DENSE,
      }),
    };
    state.compressionSmokeCompleted = true;

    state.stage = "Gateway smoke";
    state.gatewaySmoke = await runSmokeWithRetry({
      targets: PRODUCTION_SMOKE_TARGETS,
      checkDirect: true,
      checkCompression: false,
      expectedSourceRevision: state.gitRevision,
    });
    state.gatewaySmokeCompleted = true;

    state.stage = "write successful release metadata";
    const releasePath = await writeReleaseRecord({
      status: "succeeded",
      gitRevision: state.gitRevision,
      sourceRevision: state.gitRevision,
      textVersionId: state.textVersionId,
      compressionVersionId: state.compressionVersionId,
      previousCompressionVersionId: state.previousCompressionVersionId,
      gatewayVersionId: state.gatewayVersionId,
      textSmoke: state.textSmoke,
      compressionSmoke: state.compressionSmoke,
       gatewaySmoke: state.gatewaySmoke,
       textDeployment: state.textDeployment,
       compressionDeployment: state.compressionDeployment,
       mcpDeployment: state.mcpDeployment,
       gatewayDeployment: state.gatewayDeployment,
       compressionRecovery: state.compressionRecovery,
      ...buildMcpReleaseMetadata({
        versionId: state.mcpVersionId,
        previousVersionId: state.previousMcpVersionId,
        endpoint: state.mcpEndpoint,
        smoke: state.mcpSmoke,
        oauthSmoke: state.mcpOAuthSmoke,
        recovery: state.mcpRecovery,
      }),
      compressionModel: COMPRESSION_MODEL,
      compressionPromptVersion: COMPRESSION_PROMPT_VERSION,
      compressionPromptVersions: {
        compact: COMPRESSION_PROMPT_VERSION_COMPACT,
        semanticDense: COMPRESSION_PROMPT_VERSION_SEMANTIC_DENSE,
      },
    });
    console.log(`Release metadata recorded at ${path.relative(projectRoot, releasePath)}`);
  } catch (error) {
    if (state.gatewayDeployed && state.previousGatewayVersionId && !state.gatewayRecovery) {
      try {
        state.gatewayRecovery = await rollbackAfterSmokeFailure({
          previousVersionId: state.previousGatewayVersionId,
          rollback: async (versionId) => runWrangler(createWorkerRollbackArgs(
            versionId,
            "automatic-gateway-smoke-failure-rollback",
            { workerName: "api", config: "wrangler.jsonc" },
          )),
          getActiveVersionId: getActiveGatewayVersionId,
          recoverySmoke: runGatewayRecoverySmoke,
        });
      } catch (rollbackError) {
        state.gatewayRecovery = {
          status: "rollback_failed",
          targetVersionId: state.previousGatewayVersionId,
          error: rollbackError.message,
        };
      }
    }

    if (state.compressionDeployed && state.previousCompressionVersionId && !state.compressionRecovery) {
      try {
        state.compressionRecovery = await rollbackAfterSmokeFailure({
          previousVersionId: state.previousCompressionVersionId,
          rollback: async (versionId) => runWrangler(createWorkerRollbackArgs(
            versionId,
            "automatic-compression-smoke-failure-rollback",
            { workerName: "semantic-compression", config: "wrangler.semantic-compression.jsonc" },
          )),
          getActiveVersionId: getActiveCompressionVersionId,
          recoverySmoke: runCompressionRecoverySmoke,
        });
      } catch (rollbackError) {
        state.compressionRecovery = {
          status: "rollback_failed",
          targetVersionId: state.previousCompressionVersionId,
          error: rollbackError.message,
        };
      }
    }

    if (state.mcpDeployed && state.previousMcpVersionId && !state.mcpRecovery) {
      try {
        state.mcpRecovery = await rollbackAfterSmokeFailure({
          previousVersionId: state.previousMcpVersionId,
          rollback: async (versionId) => runWrangler(createWorkerRollbackArgs(
            versionId,
            "automatic-mcp-smoke-failure-rollback",
            { workerName: MCP_RELEASE_WORKER_NAME, config: MCP_RELEASE_CONFIG },
          )),
          getActiveVersionId: getActiveMcpVersionId,
          recoverySmoke: () => runMcpRecoverySmoke(mcpSmokeInputs),
        });
      } catch (rollbackError) {
        state.mcpRecovery = {
          status: "rollback_failed",
          targetVersionId: state.previousMcpVersionId,
          error: rollbackError.message,
        };
      }
    }

    if (state.textDeployed && state.previousTextVersionId && !state.textRecovery) {
      try {
        state.textRecovery = await rollbackAfterSmokeFailure({
          previousVersionId: state.previousTextVersionId,
          rollback: async (versionId) => runWrangler(createRollbackArgs(
            versionId,
            "automatic-text-smoke-failure-rollback",
          )),
          getActiveVersionId: getActiveTextVersionId,
          recoverySmoke: runGatewayRecoverySmoke,
        });
      } catch (rollbackError) {
        state.textRecovery = {
          status: "rollback_failed",
          targetVersionId: state.previousTextVersionId,
          error: rollbackError.message,
        };
      }
    }

    try {
      const releasePath = await writeReleaseRecord({
        status: "failed",
        gitRevision: state.gitRevision,
        sourceRevision: state.gitRevision,
        previousTextVersionId: state.previousTextVersionId,
        previousCompressionVersionId: state.previousCompressionVersionId,
        previousGatewayVersionId: state.previousGatewayVersionId,
        textVersionId: state.textVersionId,
        compressionVersionId: state.compressionVersionId,
        gatewayVersionId: state.gatewayVersionId,
        textSmoke: state.textSmoke,
        compressionSmoke: state.compressionSmoke,
        ...buildMcpReleaseMetadata({
          versionId: state.mcpVersionId,
          previousVersionId: state.previousMcpVersionId,
          endpoint: state.mcpEndpoint,
          smoke: state.mcpSmoke ?? resolveMcpSmokeState(process.env),
          oauthSmoke: state.mcpOAuthSmoke,
          recovery: state.mcpRecovery,
        }),
        gatewaySmoke: state.gatewaySmoke,
        textRecovery: state.textRecovery,
        compressionRecovery: state.compressionRecovery,
        gatewayRecovery: state.gatewayRecovery,
        textDeployment: state.textDeployment,
        compressionDeployment: state.compressionDeployment,
        mcpDeployment: state.mcpDeployment,
        gatewayDeployment: state.gatewayDeployment,
        compressionModel: COMPRESSION_MODEL,
        compressionPromptVersion: COMPRESSION_PROMPT_VERSION,
        compressionPromptVersions: {
          compact: COMPRESSION_PROMPT_VERSION_COMPACT,
          semanticDense: COMPRESSION_PROMPT_VERSION_SEMANTIC_DENSE,
        },
        failure: {
          stage: state.stage,
          message: error.message,
        },
      });
      console.error(`Failed release metadata recorded at ${path.relative(projectRoot, releasePath)}`);
    } catch (recordError) {
      console.error(`Could not record failed release metadata: ${recordError.message}`);
    }
    throw error;
  }
}

await main();
