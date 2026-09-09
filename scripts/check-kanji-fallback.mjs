import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateKanjiFallbackSource } from "./generate-kanji-fallback.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(projectRoot, "dist", "kanji-fallback.mjs");

try {
  const [actual, expected] = await Promise.all([
    readFile(outputPath, "utf8"),
    generateKanjiFallbackSource(projectRoot),
  ]);
  if (actual !== expected) {
    console.error(`Generated kanji fallback is stale: ${path.relative(projectRoot, outputPath)}`);
    process.exitCode = 1;
  } else {
    console.log("Generated kanji fallback is up to date.");
  }
} catch (error) {
  if (error?.code === "ENOENT") {
    console.error(`Generated kanji fallback is missing: ${path.relative(projectRoot, outputPath)}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
