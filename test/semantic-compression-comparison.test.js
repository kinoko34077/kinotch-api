import test from "node:test";
import assert from "node:assert/strict";
import { buildQualityComparison } from "../scripts/compare-compression-quality.mjs";

function record(id, category, input, output, semanticClassification = null) {
  return {
    id,
    category,
    input,
    compressed_text: output,
    provenance: {
      input_chars: input.length,
      output_chars: output.length,
    },
    marker_checks: [{ kind: "required", marker: "marker", present: true }],
    semantic_classification: semanticClassification,
  };
}

test("quality comparison reports metrics without turning missing human review into PASS", () => {
  const comparison = buildQualityComparison(
    { prompt_variant: "control", records: [record("q01", "short", "abcd", "ab", "PASS")] },
    { prompt_variant: "candidate", records: [record("q01", "short", "abcd", "abcde", null)] },
  );

  assert.deepEqual(comparison.control.semantic, { PASS: 1, REVIEW: 0, FAIL: 0, UNCLASSIFIED: 0 });
  assert.deepEqual(comparison.candidate.semantic, { PASS: 0, REVIEW: 0, FAIL: 0, UNCLASSIFIED: 1 });
  assert.equal(comparison.control.marker.retained, 1);
  assert.equal(comparison.candidate.expandedCaseCount, 1);
  assert.equal(comparison.candidate.totalRatio, 1.25);
});
