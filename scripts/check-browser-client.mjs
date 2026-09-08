import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateBrowserClientSource } from "./generate-browser-client.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(projectRoot, "src", "client", "text-transform.iife.js");
const [actual, expected] = await Promise.all([
  readFile(outputPath, "utf8"),
  generateBrowserClientSource(projectRoot),
]);

if (actual !== expected) {
  console.error(`Generated browser client is stale: ${path.relative(projectRoot, outputPath)}`);
  console.error("Run `npm run build:browser-client` and review the generated diff.");
  process.exitCode = 1;
} else {
  console.log("Generated browser client is up to date.");
}

