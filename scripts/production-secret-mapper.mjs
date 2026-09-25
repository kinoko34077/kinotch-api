import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createReleaseChildEnv } from "./release-child-env.mjs";

export const PRODUCTION_SECRET_RELATIVE_PATH = join(".kinotch-secrets", "kinotch-api.production.env");
export const PRODUCTION_SECRET_DISPLAY_PATH = "%USERPROFILE%\\.kinotch-secrets\\kinotch-api.production.env";

export const ALLOWED_PRODUCTION_SECRET_KEYS = Object.freeze([
  "TEAM_DOMAIN",
  "POLICY_AUD",
  "MCP_ENDPOINT",
  "CF_ACCESS_CLIENT_ID",
  "CF_ACCESS_CLIENT_SECRET",
  "COMPRESSION_SMOKE_TOKEN",
  "JEV_AUDIT_MCP_POLICY_AUD",
  "JEV_AUDIT_SMOKE_TOKEN",
  "JEV_AUDIT_MCP_SMOKE_ACCESS_COOKIE",
]);

export const MAPPER_MODES = Object.freeze({
  MCP_SMOKE: "mcp-smoke",
  PRODUCTION_RELEASE: "production-release",
});

const MODE_KEYS = Object.freeze({
  [MAPPER_MODES.MCP_SMOKE]: Object.freeze([
    "MCP_ENDPOINT",
    "CF_ACCESS_CLIENT_ID",
    "CF_ACCESS_CLIENT_SECRET",
  ]),
  [MAPPER_MODES.PRODUCTION_RELEASE]: ALLOWED_PRODUCTION_SECRET_KEYS,
});

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function safeKeyName(key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : "<invalid-key-name>";
}

function assertKnownKeys(secrets) {
  const allowed = new Set(ALLOWED_PRODUCTION_SECRET_KEYS);
  const unknownKeys = Object.keys(secrets).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown production secret key: ${unknownKeys.map(safeKeyName).join(", ")}`);
  }
}

export function getProductionSecretPath({ homeDirectory = homedir() } = {}) {
  return join(homeDirectory, PRODUCTION_SECRET_RELATIVE_PATH);
}

export function parseProductionSecretText(sourceText) {
  let parsed;
  try {
    parsed = parseEnv(sourceText);
  } catch {
    throw new Error("Could not parse production secret file");
  }

  assertKnownKeys(parsed);
  return Object.freeze({
    ...Object.fromEntries(
      ALLOWED_PRODUCTION_SECRET_KEYS
        .filter((key) => Object.prototype.hasOwnProperty.call(parsed, key))
        .map((key) => [key, parsed[key]]),
    ),
  });
}

export async function loadProductionSecrets({
  homeDirectory = homedir(),
  readFileImpl = readFile,
} = {}) {
  const secretPath = getProductionSecretPath({ homeDirectory });
  let sourceText;
  try {
    sourceText = await readFileImpl(secretPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Production secret file was not found: ${PRODUCTION_SECRET_DISPLAY_PATH}`);
    }
    throw new Error("Could not read production secret file");
  }
  return parseProductionSecretText(sourceText);
}

export function requiredKeysForMode(mode) {
  const requiredKeys = MODE_KEYS[mode];
  if (!requiredKeys) throw new Error(`Unknown production secret mapper mode: ${mode}`);
  return [...requiredKeys];
}

export function mapProductionSecrets(secrets, mode) {
  assertKnownKeys(secrets);
  const requiredKeys = requiredKeysForMode(mode);
  const missingKeys = requiredKeys.filter(
    (key) => typeof secrets[key] !== "string" || secrets[key].length === 0,
  );
  if (missingKeys.length > 0) {
    throw new Error(`Missing required production secret keys:\n${missingKeys.map((key) => `- ${key}`).join("\n")}`);
  }
  return Object.freeze(Object.fromEntries(requiredKeys.map((key) => [key, secrets[key]])));
}

export function createMappedChildEnv({ mode, sourceEnv = process.env, secrets }) {
  const mappedSecrets = mapProductionSecrets(secrets, mode);
  const childEnv = createReleaseChildEnv(sourceEnv, {
    includeCloudflareCredentials: mode === MAPPER_MODES.PRODUCTION_RELEASE,
  });
  return Object.freeze({ ...childEnv, ...mappedSecrets });
}

function childArgsForMode(mode) {
  if (mode === MAPPER_MODES.MCP_SMOKE) return ["run", "smoke:mcp"];
  if (mode === MAPPER_MODES.PRODUCTION_RELEASE) return ["run", "deploy:production"];
  throw new Error(`Unknown production secret mapper mode: ${mode}`);
}

export function resolveMappedCommandInvocation(
  mode,
  {
    platform = process.platform,
    sourceEnv = process.env,
  } = {},
) {
  const npmArgs = childArgsForMode(mode);
  if (platform === "win32") {
    const command = sourceEnv.ComSpec ?? sourceEnv.COMSPEC ?? "cmd.exe";
    return Object.freeze({
      command,
      args: Object.freeze(["/d", "/s", "/c", `npm.cmd ${npmArgs.join(" ")}`]),
    });
  }
  return Object.freeze({
    command: "npm",
    args: Object.freeze(npmArgs),
  });
}

function runChild({ command, args, options, spawnImpl }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, args, options);
    } catch {
      reject(new Error("Could not start mapped production command"));
      return;
    }
    child.once("error", () => reject(new Error("Mapped production command failed to start")));
    child.once("close", (code, signal) => {
      if (typeof code === "number") {
        resolve(code);
      } else {
        reject(new Error(`Mapped production command ended by ${signal ?? "unknown signal"}`));
      }
    });
  });
}

export async function runMappedCommand(
  mode,
  {
    secrets,
    sourceEnv = process.env,
    spawnImpl = spawn,
    cwd = projectRoot,
  } = {},
) {
  const invocation = resolveMappedCommandInvocation(mode, { sourceEnv });
  const env = createMappedChildEnv({ mode, sourceEnv, secrets });
  return runChild({
    command: invocation.command,
    args: invocation.args,
    options: { cwd, env, stdio: "inherit" },
    spawnImpl,
  });
}

export async function main(
  argv = process.argv.slice(2),
  {
    homeDirectory = homedir(),
    sourceEnv = process.env,
    readFileImpl = readFile,
    spawnImpl = spawn,
    cwd = projectRoot,
  } = {},
) {
  try {
    if (argv.length !== 1 || !Object.values(MAPPER_MODES).includes(argv[0])) {
      throw new Error("Production secret mapper requires exactly one supported mode argument");
    }
    const secrets = await loadProductionSecrets({ homeDirectory, readFileImpl });
    const requiredKeys = requiredKeysForMode(argv[0]);
    console.log("Production secret file: available");
    console.log(`Production secret mapping: ${requiredKeys.length} required keys available`);
    return await runMappedCommand(argv[0], { secrets, sourceEnv, spawnImpl, cwd });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Production secret mapper failed");
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
