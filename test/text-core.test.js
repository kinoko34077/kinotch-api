import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../src/text-core/index.cjs");

test("core exposes the extracted ruby parser", () => {
  const segments = core.shared.parseRenderableRubySegments(
    "｜山田太郎《やまだたろう》と空《そら》",
  );

  assert.deepEqual(segments, [
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

test("core applies a legacy-kanji dictionary stage", () => {
  const stage = {
    id: "legacy-kanji",
    kind: "dictionary-rules",
    order: 40,
    rules: [
      { from: "学", to: "學", enabled: true, regex: false, priority: 10 },
      { from: "国", to: "國", enabled: true, regex: false, priority: 10 },
    ],
  };

  assert.equal(
    core.engine.transformTextWithStages("学校と国", [stage], null),
    "學校と國",
  );
});

test("core dictionary validator and compiler are available", () => {
  const dictionary = {
    words: [
      { id: "modern", value: "学" },
      { id: "legacy", value: "學" },
    ],
    relations: [{
      id: "variant",
      sources: ["modern"],
      targets: [{ word_id: "legacy", default: true }],
      type: "replacement",
      mode: "default",
      enabled: true,
    }],
  };

  assert.equal(core.dictionary.validateDictionary(dictionary).errors.length, 0);
  const compiled = core.dictionary.compileExecutableDictionary(dictionary, []).rules;
  assert.equal(compiled.length, 1);
  assert.equal(compiled[0].from, "学");
  assert.equal(compiled[0].to, "學");
  assert.equal(compiled[0].enabled, true);
});
