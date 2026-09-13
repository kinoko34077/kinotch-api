import test from "node:test";
import assert from "node:assert/strict";
import { buildHumanReviewReport } from "../scripts/build-compression-review.mjs";

function artifact(promptVariant, id, input, output) {
  return {
    prompt_variant: promptVariant,
    records: [{
      id,
      category: "spec",
      input,
      compressed_text: output,
      provenance: { input_chars: input.length, output_chars: output.length },
      marker_checks: [],
    }],
  };
}

test("human review report keeps semantic classification separate from mechanical markers", () => {
  const report = buildHumanReviewReport(
    artifact("control", "q47", "禁止対象", "欠落"),
    artifact("candidate", "q47", "禁止対象", "欠落"),
  );

  assert.deepEqual(report.control.summary, { PASS: 0, REVIEW: 0, FAIL: 1 });
  assert.deepEqual(report.candidate.summary, { PASS: 0, REVIEW: 0, FAIL: 1 });
  assert.equal(report.control.records[0].semantic_classification, "FAIL");
  assert.equal(report.candidate.records[0].semantic_classification, "FAIL");
  assert.equal(report.control.records[0].marker_missing.length, 0);
  assert.match(report.assessment, /人手レビュー/);
});
