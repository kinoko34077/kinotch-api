import test from "node:test";
import assert from "node:assert/strict";
import {
  compareKanjiKeys,
  generateKanjiFallbackSource,
} from "../scripts/generate-kanji-fallback.mjs";

test("kanji fallback keys use locale-independent code-unit ordering", () => {
  const keys = ["亜", "悪", "圧", "暗", "囲", "為", "医", "壱"];
  assert.deepEqual(
    keys.sort(compareKanjiKeys),
    ["亜", "医", "囲", "圧", "壱", "悪", "暗", "為"],
  );
});

test("kanji fallback generation applies the deterministic ordering", async () => {
  const source = await generateKanjiFallbackSource(process.cwd());
  const match = source.match(/Object\.freeze\((.+)\);\n$/);
  assert.ok(match);

  const pairs = JSON.parse(match[1]);
  const keys = pairs.map(([key]) => key);
  assert.deepEqual(keys, [...keys].sort(compareKanjiKeys));
});
