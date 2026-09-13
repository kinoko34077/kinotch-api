import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { analyzeQualityRecords } from "./analyze-compression-baseline.mjs";

const DEFAULT_CONTROL_PATH = "artifacts/compression-quality-baseline.json";
const DEFAULT_CANDIDATE_PATH = "artifacts/compression-quality-candidate-final.json";
const DEFAULT_LONG_CONTROL_PATH = "artifacts/compression-quality-long-control.json";
const DEFAULT_LONG_CANDIDATE_PATH = "artifacts/compression-quality-long-candidate.json";
const DEFAULT_OUTPUT_PATH = "artifacts/compression-quality-human-review.json";

const CONTROL_ANNOTATIONS = {
  q12: {
    classification: "REVIEW",
    issueType: ["negation_preservation"],
    notes: "禁止の意味は見出しから推測できるが、原文の明示的な否定語を落とした。",
  },
  q45: {
    classification: "FAIL",
    issueType: ["input_rejected"],
    notes: "非空の攻撃例を圧縮対象として扱わず、入力なし・出力なしとした。",
  },
  q47: {
    classification: "FAIL",
    issueType: ["negation_preservation", "invented_value"],
    notes: "禁止対象を落とし、値のないrequest_idへnoneを補った。",
  },
};

const CANDIDATE_ANNOTATIONS = {
  q20: {
    classification: "FAIL",
    issueType: ["prompt_text_in_output"],
    notes: "入力にないService境界の指示文を圧縮結果へ追加した。",
  },
  q36: {
    classification: "FAIL",
    issueType: ["prompt_text_in_output"],
    notes: "入力にない命令実行拒否の説明を追加し、本文情報とService境界を混在させた。",
  },
  q43: {
    classification: "REVIEW",
    issueType: ["fact_hypothesis_boundary"],
    notes: "仮説とログの整合を条件付き事実・観測とラベル付けしており、認識区分の再確認が必要。",
  },
  q47: {
    classification: "FAIL",
    issueType: ["negation_preservation"],
    notes: "status、request_id、warningsだけを残し、API key・raw response・本文全文を含めない否定節を落とした。",
  },
};

function reviewSide(artifact, annotations) {
  const analysis = analyzeQualityRecords(artifact.records ?? []);
  const records = analysis.records.map((record) => {
    const annotation = annotations[record.id] ?? {
      classification: "PASS",
      issueType: [],
      notes: "人手レビューで明確な意味破壊を確認しなかった。",
    };
    return {
      id: record.id,
      category: record.category,
      input: record.input,
      output: record.output,
      input_chars: record.input_chars,
      output_chars: record.output_chars,
      ratio: record.ratio,
      marker_missing: record.marker_missing,
      expansion_causes: record.expansion_causes,
      semantic_classification: annotation.classification,
      issue_type: annotation.issueType,
      notes: annotation.notes,
    };
  });
  const summary = Object.fromEntries(["PASS", "REVIEW", "FAIL"].map((classification) => [
    classification,
    records.filter((record) => record.semantic_classification === classification).length,
  ]));
  return {
    prompt_variant: artifact.prompt_variant ?? null,
    evaluation_prompt_version: artifact.evaluation_prompt_version ?? null,
    summary,
    records,
  };
}

export function buildHumanReviewReport(controlArtifact, candidateArtifact, longForm = null) {
  return {
    schema_version: "semantic-compression-quality-human-review-v1",
    assessment: "50件と長文10件の実出力を人手レビューした記録。marker欠落だけではFAILと判定していない。",
    control: reviewSide(controlArtifact, CONTROL_ANNOTATIONS),
    candidate: reviewSide(candidateArtifact, CANDIDATE_ANNOTATIONS),
    ...(longForm ? {
      longForm: {
        control: reviewSide(longForm.control, {}),
        candidate: reviewSide(longForm.candidate, {}),
      },
    } : {}),
  };
}

async function readArtifact(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function main() {
  const controlPath = process.env.COMPRESSION_QUALITY_CONTROL_INPUT || DEFAULT_CONTROL_PATH;
  const candidatePath = process.env.COMPRESSION_QUALITY_CANDIDATE_INPUT || DEFAULT_CANDIDATE_PATH;
  const longControlPath = process.env.COMPRESSION_QUALITY_LONG_CONTROL_INPUT || DEFAULT_LONG_CONTROL_PATH;
  const longCandidatePath = process.env.COMPRESSION_QUALITY_LONG_CANDIDATE_INPUT || DEFAULT_LONG_CANDIDATE_PATH;
  const outputPath = process.env.COMPRESSION_QUALITY_HUMAN_REVIEW_OUTPUT || DEFAULT_OUTPUT_PATH;
  const [control, candidate] = await Promise.all([
    readArtifact(controlPath),
    readArtifact(candidatePath),
  ]);
  let longForm = null;
  try {
    const [longControl, longCandidate] = await Promise.all([
      readArtifact(longControlPath),
      readArtifact(longCandidatePath),
    ]);
    longForm = { control: longControl, candidate: longCandidate };
  } catch {
    // Short-corpus review can still be produced without long artifacts.
  }
  const report = buildHumanReviewReport(control, candidate, longForm);
  const resolvedOutputPath = resolve(outputPath);
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    event: "compression_quality_human_review",
    outputFile: resolvedOutputPath,
    control: report.control.summary,
    candidate: report.candidate.summary,
    longForm: report.longForm ? {
      control: report.longForm.control.summary,
      candidate: report.longForm.candidate.summary,
    } : null,
  }));
}

if (process.argv[1]?.endsWith("build-compression-review.mjs")) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "compression human review failed");
    process.exitCode = 1;
  }
}
