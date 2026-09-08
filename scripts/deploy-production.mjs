import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import JSON5 from "json5";
import { assertPrivateTextWorkerConfig } from "./deploy-guards.mjs";
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

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runSmokeWithRetry(options, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runProductionSmoke(options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(2_000);
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

const sourceRevision = await gitRevision();
if (!/^[a-f0-9]{40}$/.test(sourceRevision)) {
  throw new Error("Could not determine a 40-character Git source revision for production release");
}

const textWorkerConfig = JSON5.parse(await readFile(
  path.join(projectRoot, "wrangler.text-transform.jsonc"),
  "utf8",
));
assertPrivateTextWorkerConfig(textWorkerConfig);

await run(npmCommand, ["run", "build:text-snapshot"]);
await run(npmCommand, ["run", "check:text-snapshot"]);
await run(npmCommand, ["test"]);
await run(npxCommand, [
  "wrangler",
  "deploy",
  "--config",
  "wrangler.text-transform.jsonc",
  "--dry-run",
  "--var",
  `TEXT_CORE_SOURCE_REVISION:${sourceRevision}`,
]);
await run(npxCommand, ["wrangler", "deploy", "--config", "wrangler.jsonc", "--dry-run"]);

const textDeployOutput = await run(
  npxCommand,
  [
    "wrangler",
    "deploy",
    "--config",
    "wrangler.text-transform.jsonc",
    "--var",
    `TEXT_CORE_SOURCE_REVISION:${sourceRevision}`,
  ],
  { capture: true },
);
const textVersionId = getVersionId(textDeployOutput, "text-transform");
const textSmoke = await runSmokeWithRetry({
  checkDirect: true,
  checkGuards: false,
  expectedSourceRevision: sourceRevision,
});

const gatewayDeployOutput = await run(
  npxCommand,
  ["wrangler", "deploy", "--config", "wrangler.jsonc"],
  { capture: true },
);
const gatewayVersionId = getVersionId(gatewayDeployOutput, "api");
const gatewaySmoke = await runSmokeWithRetry({ checkDirect: true, expectedSourceRevision: sourceRevision });

const recordedAt = new Date();
const releaseRecord = {
  recordedAtUtc: recordedAt.toISOString(),
  recordedAtJst: new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(recordedAt),
  gitRevision: sourceRevision,
  textVersionId,
  gatewayVersionId,
  textSmoke,
  gatewaySmoke,
};
const releasesDirectory = path.join(projectRoot, "docs", "releases");
await mkdir(releasesDirectory, { recursive: true });
const releasePath = path.join(
  releasesDirectory,
  `${recordedAt.toISOString().replaceAll(/[-:.]/g, "").replace(/Z$/, "Z")}.json`,
);
await writeFile(releasePath, `${JSON.stringify(releaseRecord, null, 2)}\n`, "utf8");
console.log(`Release metadata recorded at ${path.relative(projectRoot, releasePath)}`);
