import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateTextMetadataSource } from "./generate-text-metadata.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(projectRoot, "src", "text-core", "metadata.generated.mjs");
const generated = await generateTextMetadataSource(projectRoot);

await writeFile(outputPath, generated, "utf8");
console.log(`Generated ${path.relative(projectRoot, outputPath)}`);

