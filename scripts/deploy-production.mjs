import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
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

await run(npmCommand, ["run", "build:text-snapshot"]);
await run(npmCommand, ["run", "check:text-snapshot"]);
await run(npmCommand, ["test"]);
await run(npxCommand, ["wrangler", "deploy", "--config", "wrangler.text-transform.jsonc", "--dry-run"]);
await run(npxCommand, ["wrangler", "deploy", "--config", "wrangler.jsonc", "--dry-run"]);

const textDeployOutput = await run(
  npxCommand,
  ["wrangler", "deploy", "--config", "wrangler.text-transform.jsonc"],
  { capture: true },
);
const textVersionId = getVersionId(textDeployOutput, "text-transform");
const textSmoke = await runProductionSmoke({ checkDirect: true, checkGuards: false });

const gatewayDeployOutput = await run(
  npxCommand,
  ["wrangler", "deploy", "--config", "wrangler.jsonc"],
  { capture: true },
);
const gatewayVersionId = getVersionId(gatewayDeployOutput, "api");
const gatewaySmoke = await runProductionSmoke({ checkDirect: true });

const recordedAt = new Date();
const releaseRecord = {
  recordedAtUtc: recordedAt.toISOString(),
  recordedAtJst: new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(recordedAt),
  gitRevision: await gitRevision(),
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
