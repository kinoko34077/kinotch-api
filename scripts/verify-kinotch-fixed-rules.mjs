import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import JSON5 from "json5";

const EXPECTED_LOCK = {
  schemaVersion: "1",
  sourceRepository: "kinoko34077/japanese-orthography",
  coreCommit: "671e5e58a39e925653389e5547a7316ca51ec57f",
  artifactPath: "test/golden/kinotch-profile",
  artifactSchemaVersion: "1",
  profileId: "kinotch-fixed",
  buildSourceIdentity: "canonical-content-addressed",
  artifactGeneration: "9b0971ca30ba5dcecda05c0c615f84e74e1cb06a9f155bfb6a90c2a7bf80db16",
  canonicalSourceDigest: "cd3bc74e9daa4fb5a40f2f5962bb4263187aaaf6b9bfc206732993dcc6ccdf69",
  sourceSetDigest: "df96296fedabfe0355c6c799b5eaf538d2f35923467ee9d4c1bfbe6b276e7acd",
  adoptedSourceSet: [
    {
      repository: "kinoko34077/txt-auto-replace",
      commit: "b1227053c5df94c148ca2027b897a69199801e4e",
      path: "transforms/40-legacy-kanji.json5",
      blobSha: "57177fb8fba471f9c169283dcbae5830d5bac64f",
      role: "legacy",
    },
    {
      repository: "kinoko34077/txt-auto-replace",
      commit: "b1227053c5df94c148ca2027b897a69199801e4e",
      path: "transforms/50-official-homophone-restoration.json5",
      blobSha: "c3e35dd4431deeb13b94a7f3d5e43f978ed73ef3",
      role: "official-homophone",
    },
    {
      repository: "kinoko34077/txt-auto-replace",
      commit: "b1227053c5df94c148ca2027b897a69199801e4e",
      path: "transforms/55-homophone-kanji.json5",
      blobSha: "3d4ff5f2c1bdf8dd1cea4832d0a6d08592a218fd",
      role: "project-homophone",
    },
  ],
  files: [
    {
      path: "src/text-core/rules/40-legacy-kanji.json5",
      upstreamArtifactPath: "test/golden/kinotch-profile/40-legacy-kanji.json5",
      payloadDigest: "88c0a09376690c677cc893aa5408809ad85ebe8996a3d9af158cbc788eadf70c",
      byteLength: 2089,
    },
    {
      path: "src/text-core/rules/50-official-homophone-restoration.json5",
      upstreamArtifactPath: "test/golden/kinotch-profile/50-official-homophone-restoration.json5",
      payloadDigest: "c0a0de5eeb0332313745ed2067285e2bbf3540a63683701f684c63d4a9b41d83",
      byteLength: 29504,
    },
    {
      path: "src/text-core/rules/55-homophone-kanji.json5",
      upstreamArtifactPath: "test/golden/kinotch-profile/55-homophone-kanji.json5",
      payloadDigest: "19ea69493a53fee296e5403b52ac8ad93a61a74c44d6622078c4c0b53c712527",
      byteLength: 356,
    },
  ],
};

const EXPECTED_BUNDLES = [
  {
    id: "legacy-kanji",
    path: "transforms/40-legacy-kanji.json5",
    order: 40,
  },
  {
    id: "official-homophone-restoration",
    path: "transforms/50-official-homophone-restoration.json5",
    order: 50,
  },
  {
    id: "homophone-kanji",
    path: "transforms/55-homophone-kanji.json5",
    order: 55,
  },
];

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function fail(message) {
  throw new Error(`Canonical fixed rule-pack verification failed: ${message}`);
}

export async function verifyKinotchFixedRules(projectRoot) {
  const rulesDirectory = path.join(projectRoot, "src", "text-core", "rules");
  const lockPath = path.join(rulesDirectory, "kinotch-fixed-source-lock.json");
  let lock;

  try {
    lock = JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    fail(`cannot read source lock (${error.code ?? error.name})`);
  }

  if (!isDeepStrictEqual(lock, EXPECTED_LOCK)) {
    fail("source lock differs from the accepted canonical artifact identity");
  }

  for (const expected of EXPECTED_LOCK.files) {
    const filePath = path.join(projectRoot, expected.path);
    let content;
    try {
      content = await readFile(filePath);
    } catch (error) {
      fail(`${expected.path} cannot be read (${error.code ?? error.name})`);
    }

    const actualLength = content.byteLength;
    const actualDigest = sha256(content);
    if (actualLength !== expected.byteLength) {
      fail(`${expected.path} byte length drifted (${actualLength} != ${expected.byteLength})`);
    }
    if (actualDigest !== expected.payloadDigest) {
      fail(`${expected.path} payload digest drifted`);
    }
  }

  const manifestPath = path.join(rulesDirectory, "transform-bundles.json5");
  const manifest = JSON5.parse(await readFile(manifestPath, "utf8"));

  for (const expected of EXPECTED_BUNDLES) {
    const matches = (manifest.bundles ?? []).filter((bundle) => bundle.id === expected.id);
    if (matches.length !== 1) {
      fail(`${expected.id} must appear exactly once in transform-bundles.json5`);
    }
    const [bundle] = matches;
    if (
      bundle.path !== expected.path
      || bundle.order !== expected.order
      || bundle.enabled !== true
    ) {
      fail(`${expected.id} loader path/order/enabled state drifted`);
    }
  }

  return lock;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const projectRoot = path.resolve(path.dirname(currentFile), "..");
  try {
    const lock = await verifyKinotchFixedRules(projectRoot);
    console.log(`Canonical fixed rule packs verified -> ${lock.coreCommit}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
