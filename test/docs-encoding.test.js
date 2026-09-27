import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const docsRoot = join(repoRoot, "docs");

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

test("markdown docs are UTF-8 without BOM or known CP932 mojibake", () => {
  const failures = [];
  for (const path of markdownFiles(docsRoot).sort()) {
    const raw = readFileSync(path);
    const name = relative(repoRoot, path).replaceAll("\\", "/");
    if (raw.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) failures.push(`${name}: UTF-8 BOM`);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    if (text.includes("窶")) failures.push(`${name}: known CP932 mojibake marker`);
  }
  assert.deepEqual(failures, []);
});