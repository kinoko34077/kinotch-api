import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateTextClientSource } from "./generate-text-client.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(projectRoot, "dist", "text-transform.mjs");

try {
  const [actual, expected] = await Promise.all([
    readFile(outputPath, "utf8"),
    generateTextClientSource(projectRoot),
  ]);

  if (actual !== expected) {
    console.error(`Generated text client is stale: ${path.relative(projectRoot, outputPath)}`);
    console.error("Run `npm run build:text-client` and review the generated diff.");
    process.exitCode = 1;
  } else {
    console.log("Generated text client is up to date.");
  }
} catch (error) {
  if (error?.code === "ENOENT") {
    console.error(`Generated text client is missing: ${path.relative(projectRoot, outputPath)}`);
    console.error("Run `npm run build:text-client` first.");
    process.exitCode = 1;
  } else {
    throw error;
  }
}
