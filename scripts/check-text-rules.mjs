import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateTextRulesSource } from "./generate-text-rules.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(projectRoot, "src", "text-core", "rules.generated.mjs");
const [actual, expected] = await Promise.all([
  readFile(outputPath, "utf8"),
  generateTextRulesSource(projectRoot),
]);

if (actual !== expected) {
  console.error(`Generated rule file is stale: ${path.relative(projectRoot, outputPath)}`);
  console.error("Run `npm run build:text-rules` and review the generated diff.");
  process.exitCode = 1;
} else {
  console.log("Generated rule file is up to date.");
}
