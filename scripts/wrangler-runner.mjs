import path from "node:path";

export function createWranglerInvocation(args, { projectRoot } = {}) {
  if (!Array.isArray(args)) throw new TypeError("Wrangler args must be an array");
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
