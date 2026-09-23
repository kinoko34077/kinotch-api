import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isMissingWorkerDeploymentError,
  parseOptionalActiveVersionId,
} from "./release-recovery.mjs";
import { assertProductionSourceRevision } from "./production-source-gate.mjs";
import { MCP_RELEASE_WORKER_NAME } from "./mcp-release.mjs";

export const MCP_BOOTSTRAP_CONFIG = "wrangler.semantic-compression-mcp.jsonc";
export const MCP_BOOTSTRAP_CONFIRMATION = "MCP_BOOTSTRAP_CONFIRM";

function requiredBootstrapConfirmation(env) {
  if (env?.[MCP_BOOTSTRAP_CONFIRMATION] !== "true") {
    throw new Error("MCP bootstrap requires MCP_BOOTSTRAP_CONFIRM=true");
  }
}

export function assertMcpBootstrapConfirmation(env = process.env) {
  requiredBootstrapConfirmation(env);
}

export function createMcpBootstrapDeployArgs({ dryRun = false } = {}) {
  return [
    "wrangler",
    "deploy",
    "--config",
    MCP_BOOTSTRAP_CONFIG,
    ...(dryRun ? ["--dry-run"] : []),
  ];
}

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

function runGit(args, options = {}) {
  return run("git", [
    "-c",
    `safe.directory=${projectRoot.replaceAll("\\", "/")}`,
    ...args,
  ], options);
}

function getVersionId(output) {
  const versionId = output.match(/Current Version ID:\s*([0-9a-f-]{36})/i)?.[1];
  if (!versionId) throw new Error("Could not read the MCP Worker Version ID from Wrangler output");
  return versionId;
}

async function assertCleanWorktree() {
  const output = await runGit(["status", "--porcelain"], { capture: true });
  if (output.trim() !== "") throw new Error("MCP bootstrap requires a clean Git worktree");
}

async function getExistingMcpVersionId() {
  const result = await run(npxCommand, [
    "wrangler",
    "deployments",
    "status",
    "--name",
    MCP_RELEASE_WORKER_NAME,
    "--json",
    "--config",
    MCP_BOOTSTRAP_CONFIG,
  ], { capture: true, allowFailure: true });
  if (result.code !== 0) {
    const diagnostic = `${result.output}\n${result.errorOutput}`;
    if (isMissingWorkerDeploymentError(diagnostic)) return null;
    throw new Error("MCP bootstrap could not determine whether the Worker already exists");
  }
  return parseOptionalActiveVersionId(result.output, "MCP Worker");
}

async function main() {
  assertMcpBootstrapConfirmation(process.env);
  await assertCleanWorktree();
  const sourceRevision = await assertProductionSourceRevision({ runGit });
  const existingVersionId = await getExistingMcpVersionId();
  if (existingVersionId) {
    throw new Error("MCP bootstrap is only allowed before the first MCP Worker deployment");
  }

  await run(npmCommand, ["test"]);
  await run(npxCommand, createMcpBootstrapDeployArgs({ dryRun: true }));
  const deployOutput = await run(
    npxCommand,
    createMcpBootstrapDeployArgs(),
    { capture: true },
  );
  const versionId = getVersionId(deployOutput);
  console.log(JSON.stringify({
    status: "bootstrap_deployed",
    gitRevision: sourceRevision.head,
    mcpVersionId: versionId,
    next: "Create and configure Cloudflare Access, then run npm run deploy:production with the normal authenticated MCP smoke inputs.",
  }, null, 2));
}

if (process.argv[1]?.endsWith("mcp-bootstrap.mjs")) await main();
