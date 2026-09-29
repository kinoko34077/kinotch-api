import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const EXPECTED_LOCK = {
  schemaVersion: "1",
  sourceRepository: "kinoko34077/japanese-orthography",
  coreCommit: "ad54ead84c98b31a733cafa3c88739a1b03aaf27",
  upstreamManifestPath: "runtime/manifest.json",
  upstreamManifestGitBlob: "9a48b9dcea9dac32837e373475b0a2aae21fadd4",
  semanticsVersion: "1",
  modules: [
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
  ],
};

function gitBlobSha(content) {
  const header = Buffer.from(`blob ${content.byteLength}\0`, "utf8");
  return createHash("sha1").update(header).update(content).digest("hex");
}

function fail(message) {
  throw new Error(`Canonical shared runtime verification failed: ${message}`);
}

export async function verifySharedRuntime(projectRoot) {
  const lockPath = path.join(projectRoot, "src", "text-core", "runtime-source-lock.json");
  let lock;

  try {
    lock = JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    fail(`cannot read source lock (${error.code ?? error.name})`);
  }

  if (!isDeepStrictEqual(lock, EXPECTED_LOCK)) {
    fail("source lock differs from the accepted canonical runtime identity");
  }

  for (const expected of EXPECTED_LOCK.modules) {
    const filePath = path.join(projectRoot, expected.path);
    let content;
    try {
      content = await readFile(filePath);
    } catch (error) {
      fail(`${expected.path} cannot be read (${error.code ?? error.name})`);
    }

    if (content.byteLength !== expected.byteLength) {
      fail(`${expected.path} byte length drifted (${content.byteLength} != ${expected.byteLength})`);
    }

    const actualBlob = gitBlobSha(content);
    if (actualBlob !== expected.gitBlob) {
      fail(`${expected.path} Git blob identity drifted (${actualBlob} != ${expected.gitBlob})`);
    }
  }

  return lock;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const projectRoot = path.resolve(path.dirname(currentFile), "..");
  try {
    const lock = await verifySharedRuntime(projectRoot);
    console.log(`Canonical shared runtime verified -> ${lock.coreCommit}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
