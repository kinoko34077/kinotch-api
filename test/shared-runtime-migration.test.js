import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CORE_COMMIT = "ad54ead84c98b31a733cafa3c88739a1b03aaf27";
const EXPECTED_MODULES = [
  {
    id: "transform-shared",
    path: "src/text-core/vendor/transform-shared.js",
    gitBlob: "24518621cb7816f8daee6bc67911a14bed74cac6",
    byteLength: 44306,
  },
  {
    id: "transform-engine",
    path: "src/text-core/vendor/transform-engine.js",
    gitBlob: "9ed98ce3b8075828ee431ef30cfa7d9bcdd31f49",
    byteLength: 107309,
  },
  {
    id: "structured-dictionary",
    path: "src/text-core/vendor/structured-dictionary.js",
    gitBlob: "21d9c1bc17b7ceadf29630d10ac3f905b2047883",
    byteLength: 21805,
  },
];

test("shared runtime snapshot is locked to the accepted canonical core", async () => {
  const { verifySharedRuntime } = await import("../scripts/verify-shared-runtime.mjs");
  const lock = await verifySharedRuntime(projectRoot);

  assert.equal(lock.sourceRepository, "kinoko34077/japanese-orthography");
  assert.equal(lock.coreCommit, CORE_COMMIT);
  assert.equal(lock.upstreamManifestPath, "runtime/manifest.json");
  assert.equal(lock.upstreamManifestGitBlob, "9a48b9dcea9dac32837e373475b0a2aae21fadd4");
  assert.equal(lock.semanticsVersion, "1");
  assert.deepEqual(lock.modules, EXPECTED_MODULES);
});
