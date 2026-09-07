import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import app from "../src/text-transform-worker.js";

const dictionaryDirectory = path.resolve("src/text-core/dict");
const assets = {
  async fetch(request) {
    const fileName = path.basename(new URL(request.url).pathname);
    const bytes = await readFile(path.join(dictionaryDirectory, fileName));
    return new Response(bytes, { status: 200 });
  },
};

async function transformBatch(texts, profile) {
  const response = await app.request("http://example.test/v1/transform/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts, profile }),
  }, { ASSETS: assets });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.engineVersion, "0.2.0-phase2");
  assert.deepEqual(payload.profile, profile);
  return payload.texts;
}

test("golden: tokenizer-backed extension cases remain stable", async () => {
  const texts = [
    "分かる",
    "分かります",
    "分からない",
    "分かれば",
    "分かれ",
    "当たる",
    "当たれば",
    "当たれ",
    "書き出す",
    "書き出した",
    "書き出せば",
    "悩みを書き出す。",
    "面倒ごとに当たる。",
  ];

  assert.deepEqual(
    await transformBatch(texts, ["okurigana-abbreviation"]),
    [
      "分る",
      "分ります",
      "分らない",
      "分れば",
      "分れ",
      "当る",
      "当れば",
      "当れ",
      "書出す",
      "書出した",
      "書出せば",
      "悩を書出す。",
      "面倒ごとに当る。",
    ],
  );
});

test("golden: standard non-tokenizer bundles remain stable", async () => {
  assert.deepEqual(
    await transformBatch(
      ["それをやることにした。", "学校と国", "亀と台", "コーヒーとスーパー", "これは、テスト。"],
      ["lexical-replacements", "legacy-kanji", "general-character-replacements", "katakana-long-vowel-abbreviation", "surface-normalization"],
    ),
    [
      "其をやるヿにした｡",
      "學校と國",
      "龜と臺",
      "コーヒとスーパ",
      "これは､テスト｡",
    ],
  );
});

test("golden: ruby parser preserves renderable segment structure", async () => {
  const response = await app.request("http://example.test/v1/ruby/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "｜山田太郎《やまだたろう》と空《そら》" }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.engineVersion, "0.2.0-phase2");
  assert.deepEqual(payload.segments, [
    {
      type: "ruby",
      text: "山田太郎《やまだたろう》",
      base: "山田太郎",
      ruby: "やまだたろう",
    },
    { type: "text", text: "と" },
    {
      type: "ruby",
      text: "空《そら》",
      base: "空",
      ruby: "そら",
    },
  ]);
});

test("golden: API matches the extension fallback fixture contract", async () => {
  const cases = [
    {
      texts: ["悩みを書き出す。"],
      profile: ["surface-normalization", "okurigana-abbreviation"],
      expected: ["悩を書出す｡"],
    },
    {
      texts: ["面倒ごとに当たる。"],
      profile: ["surface-normalization", "lexical-replacements", "okurigana-abbreviation"],
      expected: ["事に当る｡"],
    },
    {
      texts: ["奇跡が起きた。"],
      profile: ["surface-normalization", "official-homophone-restoration"],
      expected: ["奇蹟が起きた｡"],
    },
    {
      texts: ["コンピューター", "ユーザー", "バッター", "スタンダード"],
      profile: ["katakana-long-vowel-abbreviation"],
      expected: ["コンピュータ", "ユーザ", "バッター", "スタンダード"],
    },
  ];

  for (const fixture of cases) {
    assert.deepEqual(
      await transformBatch(fixture.texts, fixture.profile),
      fixture.expected,
    );
  }
});
