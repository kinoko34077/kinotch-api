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
  runCompressionGatewayReadiness,
  runCompressionSmoke,
  runProductionSmoke,
} from "./smoke-production.mjs";
import {
  COMPRESSION_MODEL,
  COMPRESSION_PROFILE_COMPACT,
  COMPRESSION_PROFILE_SEMANTIC_DENSE,
  COMPRESSION_PROMPT_VERSION,
} from "../src/semantic-compression/contract.js";
import {
  buildMcpReleaseMetadata,
  MCP_RELEASE_CONFIG,
  MCP_RELEASE_WORKER_NAME,
  resolveMcpSmokeState,
} from "./mcp-release.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, args, { capture = false, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    let output = "";
    let errorOutput = "";
    const collectOutput = capture || allowFailure;
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
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

function getVersionId(output, workerName) {
  const versionId = output.match(/Current Version ID:\s*([0-9a-f-]{36})/i)?.[1];
  if (!versionId) throw new Error(`Could not read the ${workerName} Version ID from Wrangler output`);
  return versionId;
}

async function getActiveTextVersionId() {
  const output = await run(npxCommand, [
    "wrangler",
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
  const output = await run(npxCommand, [
    "wrangler",
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
  const result = await run(npxCommand, [
    "wrangler",
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
  const result = await run(npxCommand, [
    "wrangler",
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
  const output = await run("git", [
    "-c",
    `safe.directory=${projectRoot.replaceAll("\\", "/")}`,
    "status",
    "--porcelain",
  ], { capture: true });
  if (output.trim() !== "") {
    throw new Error("Production release requires a clean Git worktree");
  }
}

async function assertBuildDidNotChangeTrackedFiles() {
  await run("git", [
    "-c",
    `safe.directory=${projectRoot.replaceAll("\\", "/")}`,
    "diff",
    "--exit-code",
    "--",
  ]);
  await assertCleanWorktree();
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

async function gitRevision() {
  return new Promise((resolve) => {
    const child = spawn("git", [
      "-c",
      `safe.directory=${projectRoot.replaceAll("\\", "/")}`,
      "rev-parse",
      "HEAD",
    ], { cwd: projectRoot });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.once("close", (code) => resolve(code === 0 ? output.trim() : "unknown"));
    child.once("error", () => resolve("unknown"));
  });
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
    gatewayVersionId: null,
    textSmoke: null,
    compressionSmoke: null,
    mcpSmoke: null,
    gatewaySmoke: null,
    textRecovery: null,
    compressionRecovery: null,
    mcpRecovery: null,
    gatewayRecovery: null,
    textDeployed: false,
    textSmokeCompleted: false,
    compressionDeployed: false,
    mcpDeployed: false,
    compressionSmokeCompleted: false,
    gatewayDeployed: false,
    gatewaySmokeCompleted: false,
  };

  try {
    state.stage = "clean worktree assertion";
    await assertCleanWorktree();
    state.gitRevision = await gitRevision();
    if (!/^[a-f0-9]{40}$/.test(state.gitRevision)) {
      throw new Error("Could not determine a 40-character Git source revision for production release");
    }

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

    if (typeof process.env.COMPRESSION_SMOKE_TOKEN !== "string" || process.env.COMPRESSION_SMOKE_TOKEN.length === 0) {
      throw new Error("Compression smoke requires COMPRESSION_SMOKE_TOKEN");
    }

    state.stage = "build snapshot";
    await run(npmCommand, ["run", "build:text-snapshot"]);
    state.stage = "generated file stability assertion";
    await assertBuildDidNotChangeTrackedFiles();
    state.stage = "snapshot checks";
    await run(npmCommand, ["run", "check:text-snapshot"]);
    state.stage = "test suite";
    await run(npmCommand, ["test"]);
    state.stage = "Text Worker dry-run";
    await run(npxCommand, [
      "wrangler",
      "deploy",
      "--config",
      "wrangler.text-transform.jsonc",
      "--dry-run",
      "--var",
      `TEXT_CORE_SOURCE_REVISION:${state.gitRevision}`,
    ]);
    state.stage = "Compression Worker dry-run";
    await run(npxCommand, [
      "wrangler",
      "deploy",
      "--config",
      "wrangler.semantic-compression.jsonc",
      "--dry-run",
    ]);
    state.stage = "MCP Worker dry-run";
    await run(npxCommand, [
      "wrangler",
      "deploy",
      "--config",
      MCP_RELEASE_CONFIG,
      "--dry-run",
    ]);
    state.stage = "Gateway dry-run";
    await run(npxCommand, ["wrangler", "deploy", "--config", "wrangler.jsonc", "--dry-run"]);

    state.stage = "capture previous Text Worker version";
    state.previousTextVersionId = await getActiveTextVersionId();
    state.stage = "capture previous Gateway version";
    state.previousGatewayVersionId = await getActiveGatewayVersionId();
    state.stage = "capture previous Compression Worker version";
    state.previousCompressionVersionId = await getActiveCompressionVersionId();
    state.stage = "capture previous MCP Worker version";
    state.previousMcpVersionId = await getActiveMcpVersionId();

    state.stage = "Text Worker deploy";
    const textDeployOutput = await run(
      npxCommand,
      [
        "wrangler",
        "deploy",
        "--config",
        "wrangler.text-transform.jsonc",
        "--var",
        `TEXT_CORE_SOURCE_REVISION:${state.gitRevision}`,
      ],
      { capture: true },
    );
    state.textDeployed = true;
    state.textVersionId = getVersionId(textDeployOutput, "text-transform");

    state.stage = "Text Worker smoke";
    state.textSmoke = await runSmokeWithRetry({
      checkDirect: true,
      checkGuards: false,
      checkCompression: false,
      expectedSourceRevision: state.gitRevision,
    });
    state.textSmokeCompleted = true;

    state.stage = "Compression Worker deploy";
    const compressionDeployOutput = await run(
      npxCommand,
      [
        "wrangler",
        "deploy",
        "--config",
        "wrangler.semantic-compression.jsonc",
      ],
      { capture: true },
    );
    state.compressionDeployed = true;
    state.compressionVersionId = getVersionId(compressionDeployOutput, "semantic-compression");

    state.stage = "MCP Worker deploy";
    const mcpDeployOutput = await run(
      npxCommand,
      ["wrangler", "deploy", "--config", MCP_RELEASE_CONFIG],
      { capture: true },
    );
    state.mcpDeployed = true;
    state.mcpVersionId = getVersionId(mcpDeployOutput, "semantic-compression-mcp");
    state.mcpSmoke = resolveMcpSmokeState(process.env);

    state.stage = "Gateway deploy";
    const gatewayDeployOutput = await run(
      npxCommand,
      ["wrangler", "deploy", "--config", "wrangler.jsonc"],
      { capture: true },
    );
    state.gatewayDeployed = true;
    state.gatewayVersionId = getVersionId(gatewayDeployOutput, "api");

    state.stage = "Compression Gateway readiness";
    await runCompressionGatewayReadinessWithRetry();

    state.stage = "Compression smoke";
    state.compressionSmoke = {
      compact: await runCompressionSmoke({
        token: process.env.COMPRESSION_SMOKE_TOKEN,
        profile: COMPRESSION_PROFILE_COMPACT,
      }),
      semanticDense: await runCompressionSmoke({
        token: process.env.COMPRESSION_SMOKE_TOKEN,
        profile: COMPRESSION_PROFILE_SEMANTIC_DENSE,
      }),
    };
    state.compressionSmokeCompleted = true;

    state.stage = "Gateway smoke";
    state.gatewaySmoke = await runSmokeWithRetry({
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
      compressionRecovery: state.compressionRecovery,
      ...buildMcpReleaseMetadata({
        versionId: state.mcpVersionId,
        previousVersionId: state.previousMcpVersionId,
        endpoint: process.env.MCP_ENDPOINT,
        smoke: state.mcpSmoke,
        recovery: state.mcpRecovery,
      }),
      compressionModel: COMPRESSION_MODEL,
      compressionPromptVersion: COMPRESSION_PROMPT_VERSION,
      compressionPromptVersions: {
        compact: COMPRESSION_PROFILE_COMPACT,
        semanticDense: COMPRESSION_PROFILE_SEMANTIC_DENSE,
      },
    });
    console.log(`Release metadata recorded at ${path.relative(projectRoot, releasePath)}`);
  } catch (error) {
    if (state.gatewayDeployed && state.previousGatewayVersionId && !state.gatewayRecovery) {
      try {
        state.gatewayRecovery = await rollbackAfterSmokeFailure({
          previousVersionId: state.previousGatewayVersionId,
          rollback: async (versionId) => run(npxCommand, createWorkerRollbackArgs(
            versionId,
            "automatic-gateway-smoke-failure-rollback",
            { workerName: "api", config: "wrangler.jsonc" },
          )),
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
          rollback: async (versionId) => run(npxCommand, createWorkerRollbackArgs(
            versionId,
            "automatic-compression-smoke-failure-rollback",
            { workerName: "semantic-compression", config: "wrangler.semantic-compression.jsonc" },
          )),
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
          rollback: async (versionId) => run(npxCommand, createWorkerRollbackArgs(
            versionId,
            "automatic-mcp-smoke-failure-rollback",
            { workerName: MCP_RELEASE_WORKER_NAME, config: MCP_RELEASE_CONFIG },
          )),
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
          rollback: async (versionId) => run(npxCommand, createRollbackArgs(
            versionId,
            "automatic-text-smoke-failure-rollback",
          )),
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
          endpoint: process.env.MCP_ENDPOINT,
          smoke: state.mcpSmoke ?? resolveMcpSmokeState(process.env),
          recovery: state.mcpRecovery,
        }),
        gatewaySmoke: state.gatewaySmoke,
        textRecovery: state.textRecovery,
        compressionRecovery: state.compressionRecovery,
        gatewayRecovery: state.gatewayRecovery,
        compressionModel: COMPRESSION_MODEL,
        compressionPromptVersion: COMPRESSION_PROMPT_VERSION,
        compressionPromptVersions: {
          compact: COMPRESSION_PROFILE_COMPACT,
          semanticDense: COMPRESSION_PROFILE_SEMANTIC_DENSE,
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
