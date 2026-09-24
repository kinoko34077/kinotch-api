import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const nodeVersion = (await readFile(new URL("../.node-version", import.meta.url), "utf8")).trim();
const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

test("repository declares one supported Node 22 runtime", () => {
  assert.deepEqual(packageJson.engines, { node: ">=22.18.0 <23" });
  assert.equal(nodeVersion, "22.18.0");
  assert.match(ci, /node-version:\s*22\.18\.0/);
});
