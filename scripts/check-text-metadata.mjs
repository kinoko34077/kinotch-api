import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateTextMetadataSource } from "./generate-text-metadata.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(projectRoot, "src", "text-core", "metadata.generated.mjs");
const [actual, expected] = await Promise.all([
  readFile(outputPath, "utf8"),
  generateTextMetadataSource(projectRoot),
]);

if (actual !== expected) {
  console.error(`Generated text metadata is stale: ${path.relative(projectRoot, outputPath)}`);
  console.error("Run `npm run build:text-metadata` and review the generated diff.");
  process.exitCode = 1;
} else {
  console.log("Generated text metadata is up to date.");
}

