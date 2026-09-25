import path from "node:path";

function assertArgs(args, label) {
  if (!Array.isArray(args)) throw new TypeError(`${label} args must be an array`);
}

export function createWranglerInvocation(args, { projectRoot } = {}) {
  assertArgs(args, "Wrangler");
  if (typeof projectRoot !== "string" || projectRoot.trim() === "") {
    throw new TypeError("projectRoot must be a non-empty string");
  }

  const normalizedArgs = args[0] === "wrangler" ? args.slice(1) : args;
  return {
    command: process.execPath,
    args: [
      path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js"),
      ...normalizedArgs,
    ],
    shell: false,
  };
}

export function createNpmInvocation(
  args,
  {
    platform = process.platform,
    execPath = process.execPath,
    npmExecPath = process.env.npm_execpath,
  } = {},
) {
  assertArgs(args, "npm");
  if (typeof execPath !== "string" || execPath.trim() === "") {
    throw new TypeError("execPath must be a non-empty string");
  }

  if (platform !== "win32" && !npmExecPath) {
    return { command: "npm", args: [...args], shell: false };
  }

  const cliPath = npmExecPath || path.join(
    path.dirname(execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  return {
    command: execPath,
    args: [cliPath, ...args],
    shell: false,
  };
}
