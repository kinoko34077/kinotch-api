import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { createReleaseChildEnv } from "./release-child-env.mjs";
import { createWranglerInvocation } from "./wrangler-runner.mjs";

export const SELFHOST_ENV_FILENAME = ".env";
export const SELFHOST_SECRET_KEYS = Object.freeze(["GEMINI_API_KEY"]);
export const SELFHOST_CONFIG_FILENAME = "wrangler.semantic-compression.selfhost.jsonc";

const DEFAULT_PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));

function selfHostConfigError(message) {
  return new Error(message);
}

function assertSecretValue(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw selfHostConfigError(
      "GEMINI_API_KEY is required in the repository-root .env",
    );
  }
}

export function parseSelfHostEnv(sourceText) {
  if (typeof sourceText !== "string") {
    throw selfHostConfigError("Could not parse self-host .env");
  }

  let parsed;
  try {
    parsed = parseEnv(sourceText);
  } catch {
    throw selfHostConfigError("Could not parse self-host .env");
  }

  const unsupportedKeys = Object.keys(parsed).filter(
    (key) => !SELFHOST_SECRET_KEYS.includes(key),
  );
  if (unsupportedKeys.length > 0) {
    throw selfHostConfigError(
      "Repository-root .env may contain only GEMINI_API_KEY",
    );
  }

  const value = parsed?.GEMINI_API_KEY;
  if (typeof value === "string") {
    const first = value.trimStart()[0];
    if ((first === "\"" || first === "'") && !value.trimEnd().endsWith(first)) {
      throw selfHostConfigError("Could not parse self-host .env");
    }
  }

  assertSecretValue(value);
  return Object.freeze({ GEMINI_API_KEY: value });
}

function hasUnsupportedDevVars(entries) {
  return entries.some((entry) => {
    const name = typeof entry === "string" ? entry : entry?.name;
    return name === ".dev.vars" || name?.startsWith(".dev.vars.");
  });
}

export async function loadSelfHostSecrets({
  projectRoot = DEFAULT_PROJECT_ROOT,
  readFileImpl = readFile,
  readdirImpl = readdir,
} = {}) {
  const entries = await readdirImpl(projectRoot);
  if (hasUnsupportedDevVars(entries)) {
    throw selfHostConfigError(
      "Root .dev.vars files are unsupported for selfhost:compression",
    );
  }

  const envPath = join(projectRoot, SELFHOST_ENV_FILENAME);
  let sourceText;
  try {
    sourceText = await readFileImpl(envPath, "utf8");
  } catch {
    throw selfHostConfigError(
      "Repository-root .env is required for selfhost:compression",
    );
  }
  return parseSelfHostEnv(sourceText);
}

export function createSelfHostChildEnv({ sourceEnv = process.env, secrets } = {}) {
  assertSecretValue(secrets?.GEMINI_API_KEY);
  const childEnv = createReleaseChildEnv(sourceEnv);
  childEnv.GEMINI_API_KEY = secrets.GEMINI_API_KEY;
  childEnv.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "true";
  return childEnv;
}

export function resolveSelfHostInvocation({ projectRoot = DEFAULT_PROJECT_ROOT } = {}) {
  return createWranglerInvocation(
    [
      "dev",
      "--local",
      "--config",
      SELFHOST_CONFIG_FILENAME,
      "--env-file",
      join(projectRoot, SELFHOST_ENV_FILENAME),
    ],
    { projectRoot },
  );
}

export function runSelfHostCommand({
  projectRoot = DEFAULT_PROJECT_ROOT,
  sourceEnv = process.env,
  secrets,
  spawnImpl = spawn,
} = {}) {
  const invocation = resolveSelfHostInvocation({ projectRoot });
  const env = createSelfHostChildEnv({ sourceEnv, secrets });

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(invocation.command, invocation.args, {
        cwd: projectRoot,
        env,
        shell: invocation.shell,
        stdio: "inherit",
      });
    } catch {
      reject(new Error("selfhost:compression failed to start the local Worker"));
      return;
    }

    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    child.on("error", () => {
      settle(reject, new Error("selfhost:compression failed to start the local Worker"));
    });
    child.on("close", (code) => {
      settle(resolve, Number.isInteger(code) ? code : 1);
    });
  });
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const writeError = deps.writeError ?? ((message) => process.stderr.write(`${message}\n`));
  if (argv.length !== 0) {
    writeError("selfhost:compression does not accept command-line arguments");
    return 2;
  }

  try {
    const secrets = await loadSelfHostSecrets({
      projectRoot: deps.projectRoot,
      readFileImpl: deps.readFileImpl,
      readdirImpl: deps.readdirImpl,
    });
    return await runSelfHostCommand({
      projectRoot: deps.projectRoot,
      sourceEnv: deps.sourceEnv,
      secrets,
      spawnImpl: deps.spawnImpl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown self-host error";
    writeError(message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
