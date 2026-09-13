import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeQualityRecords,
  classifyExpansionCauses,
} from "../scripts/analyze-compression-baseline.mjs";

test("quality analysis calculates overall and category compression ratios", () => {
  const analysis = analyzeQualityRecords([
    {
      id: "q01",
      category: "short",
      input: "短文",
      compressed_text: "短",
      marker_checks: [{ kind: "required", marker: "短", present: true }],
    },
    {
      id: "q02",
      category: "long",
      input: "abcd",
      compressed_text: "abcdefg",
      marker_checks: [{ kind: "required", marker: "欠落", present: false }],
    },
  ]);

  assert.equal(analysis.caseCount, 2);
  assert.equal(analysis.inputChars, 6);
  assert.equal(analysis.outputChars, 8);
  assert.equal(analysis.expandedCaseCount, 1);
  assert.equal(analysis.ratio.min, 0.5);
  assert.equal(analysis.ratio.max, 1.75);
  assert.equal(analysis.marker.total, 2);
  assert.equal(analysis.marker.present, 1);
  assert.deepEqual(analysis.categories.map(({ category }) => category), ["long", "short"]);
  assert.deepEqual(analysis.categories.find(({ category }) => category === "long"), {
    category: "long",
    caseCount: 1,
    inputChars: 4,
    outputChars: 7,
    ratio: { min: 1.75, max: 1.75, mean: 1.75, median: 1.75, p75: 1.75, p90: 1.75 },
    expandedCaseCount: 1,
    markerMissingCount: 1,
  });
});

test("expansion cause classification is mechanical and does not claim semantic correctness", () => {
  const causes = classifyExpansionCauses({
    input: "原文",
    compressed_text: "見出し\n- 原文",
    ratio: 2,
  });

  assert.ok(causes.includes("title_added"));
  assert.ok(causes.includes("bulletized"));
  assert.equal(causes.includes("meaning_preserving_necessary"), false);
});

test("long compression corpus is synthetic, diverse, and each case is at least 1000 characters", async () => {
  const { readFile } = await import("node:fs/promises");
  const corpus = JSON.parse(await readFile(
    new URL("./fixtures/semantic-compression-long.json", import.meta.url),
    "utf8",
  ));

  assert.equal(corpus.length, 10);
  assert.equal(new Set(corpus.map((entry) => entry.id)).size, corpus.length);
  assert.ok(new Set(corpus.map((entry) => entry.category)).size >= 8);
  for (const entry of corpus) {
    assert.match(entry.id, /^long-\d{2}$/);
    assert.equal(typeof entry.category, "string");
    assert.ok((entry.input + (entry.suffix ?? "")).length >= 1000, entry.id);
    assert.ok(Array.isArray(entry.markers?.required));
  }

  const serialized = JSON.stringify(corpus);
  assert.doesNotMatch(serialized, /AIza[0-9A-Za-z_-]{20,}/);
  assert.doesNotMatch(serialized, /kinoko34077|kinotch-api/);
});
