import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const nodeVersion = (await readFile(new URL("../.node-version", import.meta.url), "utf8")).trim();
const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

test("repository declares one supported Node 26 runtime", () => {
  const expectedEngines = { node: ">=26.10.0 <27" };
  assert.deepEqual(packageJson.engines, expectedEngines);
  assert.deepEqual(packageLock.packages?.[""]?.engines, expectedEngines);
  assert.equal(nodeVersion, "26.10.0");
  assert.match(ci, /node-version:\s*26\.10\.0/);
});
