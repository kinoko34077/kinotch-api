import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateTextRulesSource } from "./generate-text-rules.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(projectRoot, "src", "text-core", "rules.generated.mjs");
const generated = await generateTextRulesSource(projectRoot);

await writeFile(outputPath, generated, "utf8");
console.log(`Generated ${path.relative(projectRoot, outputPath)}`);
