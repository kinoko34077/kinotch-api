import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateKanjiFallbackSource } from "./generate-kanji-fallback.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(projectRoot, "dist", "kanji-fallback.mjs");
const generated = await generateKanjiFallbackSource(projectRoot);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, generated, "utf8");
console.log(`Generated ${path.relative(projectRoot, outputPath)}`);
