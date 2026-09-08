import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import JSON5 from "json5";
import { assertPrivateTextWorkerConfig } from "./deploy-guards.mjs";
import {
  createRollbackArgs,
  parseActiveVersionId,
  rollbackAfterSmokeFailure,
} from "./release-recovery.mjs";
import { runProductionSmoke } from "./smoke-production.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
      shell: process.platform === "win32",
    });
    if (capture) {
      child.stdout.on("data", (chunk) => {
        output += chunk;
        process.stdout.write(chunk);
      });
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(capture ? output : undefined);
      else reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? code}`));
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

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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
    textVersionId: null,
    gatewayVersionId: null,
    textSmoke: null,
    gatewaySmoke: null,
    textRecovery: null,
    textDeployed: false,
    textSmokeCompleted: false,
  };

  try {
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

    state.stage = "build snapshot";
    await run(npmCommand, ["run", "build:text-snapshot"]);
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
    state.stage = "Gateway dry-run";
    await run(npxCommand, ["wrangler", "deploy", "--config", "wrangler.jsonc", "--dry-run"]);

    state.stage = "capture previous Text Worker version";
    state.previousTextVersionId = await getActiveTextVersionId();

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
      expectedSourceRevision: state.gitRevision,
    });
    state.textSmokeCompleted = true;

    state.stage = "Gateway deploy";
    const gatewayDeployOutput = await run(
      npxCommand,
      ["wrangler", "deploy", "--config", "wrangler.jsonc"],
      { capture: true },
    );
    state.gatewayVersionId = getVersionId(gatewayDeployOutput, "api");

    state.stage = "Gateway smoke";
    state.gatewaySmoke = await runSmokeWithRetry({
      checkDirect: true,
      expectedSourceRevision: state.gitRevision,
    });

    state.stage = "write successful release metadata";
    const releasePath = await writeReleaseRecord({
      status: "succeeded",
      gitRevision: state.gitRevision,
      sourceRevision: state.gitRevision,
      textVersionId: state.textVersionId,
      gatewayVersionId: state.gatewayVersionId,
      textSmoke: state.textSmoke,
      gatewaySmoke: state.gatewaySmoke,
    });
    console.log(`Release metadata recorded at ${path.relative(projectRoot, releasePath)}`);
  } catch (error) {
    if (state.textDeployed && !state.textSmokeCompleted && state.previousTextVersionId && !state.textRecovery) {
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
        textVersionId: state.textVersionId,
        gatewayVersionId: state.gatewayVersionId,
        textSmoke: state.textSmoke,
        gatewaySmoke: state.gatewaySmoke,
        textRecovery: state.textRecovery,
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
