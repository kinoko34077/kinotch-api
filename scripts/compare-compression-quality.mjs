import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { analyzeQualityRecords } from "./analyze-compression-baseline.mjs";

const DEFAULT_CONTROL_PATH = "artifacts/compression-quality-baseline.json";
const DEFAULT_CANDIDATE_PATH = "artifacts/compression-quality-candidate-final.json";
const DEFAULT_LONG_CONTROL_PATH = "artifacts/compression-quality-long-control.json";
const DEFAULT_LONG_CANDIDATE_PATH = "artifacts/compression-quality-long-candidate.json";
const DEFAULT_OUTPUT_PATH = "artifacts/compression-quality-comparison.json";

const SEMANTIC_CLASSIFICATIONS = ["PASS", "REVIEW", "FAIL"];

function semanticSummary(records) {
  const summary = Object.fromEntries([
    ...SEMANTIC_CLASSIFICATIONS,
    "UNCLASSIFIED",
  ].map((classification) => [classification, 0]));
  for (const record of records) {
    const classification = SEMANTIC_CLASSIFICATIONS.includes(record.semantic_classification)
      ? record.semantic_classification
      : "UNCLASSIFIED";
    summary[classification] += 1;
  }
  return summary;
}

function buildMetrics(artifact) {
  const analysis = analyzeQualityRecords(artifact.records ?? []);
  return {
    promptVariant: artifact.prompt_variant ?? null,
    evaluationPromptVersion: artifact.evaluation_prompt_version ?? null,
    caseCount: analysis.caseCount,
    semantic: semanticSummary(artifact.records ?? []),
    marker: {
      total: analysis.marker.total,
      retained: analysis.marker.present,
      missing: analysis.marker.missing,
    },
    inputChars: analysis.inputChars,
    outputChars: analysis.outputChars,
    totalRatio: analysis.totalRatio,
    ratio: analysis.ratio,
    expandedCaseCount: analysis.expandedCaseCount,
  };
}

export function buildQualityComparison(controlArtifact, candidateArtifact, longForm = null) {
  return {
    schema_version: "semantic-compression-quality-comparison-v1",
    assessment: "semantic counts remain UNCLASSIFIED until human review; marker retention is auxiliary",
    control: buildMetrics(controlArtifact),
    candidate: buildMetrics(candidateArtifact),
    ...(longForm ? {
      longForm: {
        control: buildMetrics(longForm.control),
        candidate: buildMetrics(longForm.candidate),
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
  const outputPath = process.env.COMPRESSION_QUALITY_COMPARISON_OUTPUT || DEFAULT_OUTPUT_PATH;
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
    // The short-corpus comparison remains useful when long artifacts are absent.
  }
  const report = buildQualityComparison(control, candidate, longForm);
  const resolvedOutputPath = resolve(outputPath);
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    event: "compression_quality_comparison",
    outputFile: resolvedOutputPath,
    controlVariant: report.control.promptVariant,
    candidateVariant: report.candidate.promptVariant,
    controlMarkerMissing: report.control.marker.missing,
    candidateMarkerMissing: report.candidate.marker.missing,
    semanticThreshold: null,
  }));
}

if (process.argv[1]?.endsWith("compare-compression-quality.mjs")) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "compression quality comparison failed");
    process.exitCode = 1;
  }
}
