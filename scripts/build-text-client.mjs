import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateTextClientSource } from "./generate-text-client.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(projectRoot, "dist", "text-transform.mjs");
const generated = await generateTextClientSource(projectRoot);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, generated, "utf8");
console.log(`Generated ${path.relative(projectRoot, outputPath)}`);
