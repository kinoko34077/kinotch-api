import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createJevAuditProductionPhase } from "./jev-audit-production-phase.mjs";
import { createReleaseChildEnv } from "./release-child-env.mjs";
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

const state = { stage: "Jev Audit preflight" };
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

  state.stage = "core production release";
  await runCoreProductionRelease();

  await phase.smoke();
  state.stage = "write Jev Audit release metadata";
  const releasePath = await writeJevAuditReleaseRecord({
    status: "succeeded",
    ...phase.metadata(),
  });
  console.log(`Jev Audit release metadata recorded at ${path.relative(projectRoot, releasePath)}`);
} catch (error) {
  const recovery = await phase.recover();
  try {
    const releasePath = await writeJevAuditReleaseRecord({
      status: "failed",
      failure: { stage: state.stage, ...safeError(error) },
      ...phase.metadata(),
      ...recovery,
    });
    console.error(`Failed Jev Audit release metadata recorded at ${path.relative(projectRoot, releasePath)}`);
  } catch (recordError) {
    console.error(`Could not record failed Jev Audit release metadata: ${recordError.message}`);
  }
  throw error;
}
