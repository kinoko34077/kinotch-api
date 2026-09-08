import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateBrowserClientSource } from "./generate-browser-client.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(projectRoot, "src", "client", "text-transform.iife.js");
const generated = await generateBrowserClientSource(projectRoot);

await writeFile(outputPath, generated, "utf8");
console.log(`Generated ${path.relative(projectRoot, outputPath)}`);

