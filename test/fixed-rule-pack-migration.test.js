import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import app from "../src/text-transform-worker.js";

const CORE_SHA = "671e5e58a39e925653389e5547a7316ca51ec57f";
const dictionaryDirectory = path.resolve("src/text-core/dict");

const assets = {
  async fetch(request) {
    const fileName = path.basename(new URL(request.url).pathname);
    const bytes = await readFile(path.join(dictionaryDirectory, fileName));
    return new Response(bytes, { status: 200 });
  },
};

async function transformOne(text, profile) {
  const response = await app.request("http://example.test/v1/transform/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: [text], profile }),
  }, { ASSETS: assets });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.profile, profile);
  return payload.texts[0];
}

test("canonical fixed rule packs are locked to the accepted japanese-orthography artifact", () => {
  const verify = spawnSync(process.execPath, ["scripts/verify-kinotch-fixed-rules.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(
    verify.status,
    0,
    verify.stderr || verify.stdout || "fixed rule-pack verifier failed",
  );

  const lock = JSON.parse(
    requireText("src/text-core/rules/kinotch-fixed-source-lock.json"),
  );
  assert.equal(lock.coreCommit, CORE_SHA);
  assert.equal(lock.profileId, "kinotch-fixed");
  assert.equal(
    lock.canonicalSourceDigest,
    "cd3bc74e9daa4fb5a40f2f5962bb4263187aaaf6b9bfc206732993dcc6ccdf69",
  );
  assert.equal(
    lock.sourceSetDigest,
    "df96296fedabfe0355c6c799b5eaf538d2f35923467ee9d4c1bfbe6b276e7acd",
  );
});

function requireText(relativePath) {
  return spawnSync(process.execPath, ["-e", `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(relativePath)}, 'utf8'))`], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).stdout;
}

test("canonical fixed rule snapshots preserve Text Transform runtime behavior", async () => {
  assert.equal(
    await transformOne("学校", ["legacy-kanji"]),
    "學校",
  );
  assert.equal(
    await transformOne("弁護", ["legacy-kanji"]),
    "辨護",
  );
  assert.equal(
    await transformOne("奇跡", ["official-homophone-restoration"]),
    "奇蹟",
  );

  assert.ok(
    ["昂奮", "亢奮"].includes(
      await transformOne("興奮", ["official-homophone-restoration"]),
    ),
  );
  assert.ok(
    ["独逸", "独乙"].includes(
      await transformOne("ドイツ", ["homophone-kanji"]),
    ),
  );

  assert.equal(
    await transformOne("学校の奇跡。", [
      "surface-normalization",
      "legacy-kanji",
      "official-homophone-restoration",
    ]),
    "學校の奇蹟｡",
  );
});
