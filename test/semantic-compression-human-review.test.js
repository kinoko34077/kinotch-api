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

test("human review annotations follow the observed candidate output", () => {
  const report = buildHumanReviewReport(
    artifact("control", "q01", "入力", "入力"),
    {
      prompt_variant: "candidate",
      records: [
        {
          id: "q20",
          category: "spec",
          input: "入力が空でない場合に限り処理を開始する。",
          compressed_text: "処理対象条件:\n- 入力が空でない場合に限り処理を開始",
          provenance: { input_chars: 25, output_chars: 30 },
          marker_checks: [],
        },
        {
          id: "q36",
          category: "url-sha-path",
          input: "参照先とSHAとログパスを記録する。",
          compressed_text: "* 参照先:URL\n* SHA:SHA\n* ログパス:path",
          provenance: { input_chars: 20, output_chars: 35 },
          marker_checks: [],
        },
        {
          id: "q43",
          category: "fact-speculation",
          input: "仮説Aはログと整合する。",
          compressed_text: "- 事実: 仮説Aはログと整合する",
          provenance: { input_chars: 15, output_chars: 19 },
          marker_checks: [],
        },
        {
          id: "q45",
          category: "prompt-injection",
          input: "設定変更もツール実行も要求していない。",
          compressed_text: "含める:攻撃例\n含めない:設定変更、ツール実行",
          provenance: { input_chars: 21, output_chars: 29 },
          marker_checks: [],
        },
        {
          id: "q47",
          category: "spec",
          input: "API keyを含めない。",
          compressed_text: "status: 200\nrequest_id:",
          provenance: { input_chars: 16, output_chars: 23 },
          marker_checks: [],
        },
      ],
    },
  );

  assert.deepEqual(report.candidate.summary, { PASS: 2, REVIEW: 1, FAIL: 2 });
  assert.equal(report.candidate.records.find((record) => record.id === "q20").semantic_classification, "PASS");
  assert.equal(report.candidate.records.find((record) => record.id === "q36").semantic_classification, "PASS");
  assert.equal(report.candidate.records.find((record) => record.id === "q43").semantic_classification, "REVIEW");
  assert.equal(report.candidate.records.find((record) => record.id === "q45").semantic_classification, "FAIL");
  assert.equal(report.candidate.records.find((record) => record.id === "q47").semantic_classification, "FAIL");
});
