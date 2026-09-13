import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { countUnicodeCodePoints } from "../src/semantic-compression/contract.js";

const DEFAULT_INPUT_PATH = "artifacts/compression-quality-baseline.json";
const DEFAULT_OUTPUT_PATH = "artifacts/compression-quality-review.json";

function round(value) {
  return Number(value.toFixed(3));
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return round(sorted[lower]);
  return round(sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower));
}

function summarizeRatios(ratios) {
  if (ratios.length === 0) {
    return { min: null, max: null, mean: null, median: null, p75: null, p90: null };
  }
  return {
    min: round(Math.min(...ratios)),
    max: round(Math.max(...ratios)),
    mean: round(ratios.reduce((sum, value) => sum + value, 0) / ratios.length),
    median: percentile(ratios, 0.5),
    p75: percentile(ratios, 0.75),
    p90: percentile(ratios, 0.9),
  };
}

function recordCharCount(record, field, fallback) {
  const value = record.provenance?.[field];
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function buildCaseRecord(record) {
  const input = typeof record.input === "string" ? record.input : "";
  const compressedText = typeof record.compressed_text === "string" ? record.compressed_text : "";
  const inputChars = recordCharCount(record, "input_chars", countUnicodeCodePoints(input));
  const outputChars = recordCharCount(record, "output_chars", countUnicodeCodePoints(compressedText));
  const ratio = inputChars > 0 ? outputChars / inputChars : null;
  const markerChecks = Array.isArray(record.marker_checks) ? record.marker_checks : [];
  return {
    id: record.id,
    category: record.category,
    input,
    output: compressedText,
    input_chars: inputChars,
    output_chars: outputChars,
    ratio: ratio === null ? null : round(ratio),
    marker_missing: markerChecks.filter((check) => check.present !== true).map((check) => ({
      kind: check.kind,
      marker: check.marker,
    })),
    marker_count: markerChecks.length,
    marker_present_count: markerChecks.filter((check) => check.present === true).length,
    expansion_causes: ratio !== null && ratio >= 1 ? classifyExpansionCauses({
      input,
      compressed_text: compressedText,
      ratio,
    }) : [],
    semantic_classification: record.semantic_classification ?? null,
    issue_type: record.issue_type ?? [],
    notes: record.notes ?? null,
  };
}

function firstNonEmptyLine(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

function hasBulletLine(value) {
  return /(?:^|\n)\s*(?:[-*]|\d+[.)])\s+/.test(value);
}

function hasRecognitionLabel(value) {
  return /(?:^|\n)\s*(?:事実|主張|推測|仮説|評価|判断|条件|例外|禁止事項|要点|結論)\s*[:：]/.test(value);
}

export function classifyExpansionCauses({ input, compressed_text: compressedText, ratio }) {
  const causes = [];
  const inputFirstLine = firstNonEmptyLine(input);
  const outputFirstLine = firstNonEmptyLine(compressedText);
  const inputHasBullet = hasBulletLine(input);
  const outputHasBullet = hasBulletLine(compressedText);
  const inputHasLabel = hasRecognitionLabel(input);
  const outputHasLabel = hasRecognitionLabel(compressedText);

  if (outputFirstLine && outputFirstLine !== inputFirstLine
    && !outputFirstLine.startsWith("-")
    && !outputFirstLine.startsWith("*")
    && !/^\d+[.)]\s/.test(outputFirstLine)
    && !input.includes(outputFirstLine)) {
    causes.push("title_added");
  }
  if (outputHasBullet && !inputHasBullet) causes.push("bulletized");
  if (input.split(/\r?\n/).filter((line) => line.trim()).length <= 1
    && compressedText.split(/\r?\n/).filter((line) => line.trim()).length > 1) {
    causes.push("one_line_split");
  }
  if (outputHasLabel && !inputHasLabel) causes.push("recognition_labels_added");
  if (ratio >= 1.25 && causes.length === 0) causes.push("verbose_rephrase");
  if (/(?:つまり|要するに|これは|したがって|以上から)/.test(compressedText)
    && !/(?:つまり|要するに|これは|したがって|以上から)/.test(input)) {
    causes.push("extra_explanation");
  }
  if (causes.length === 0) causes.push("other");
  return causes;
}

function categorySummary(records) {
  const categories = [...new Set(records.map((record) => record.category))].sort();
  return categories.map((category) => {
    const categoryRecords = records.filter((record) => record.category === category);
    const ratios = categoryRecords.flatMap((record) => record.ratio === null ? [] : [record.ratio]);
    return {
      category,
      caseCount: categoryRecords.length,
      inputChars: categoryRecords.reduce((sum, record) => sum + record.input_chars, 0),
      outputChars: categoryRecords.reduce((sum, record) => sum + record.output_chars, 0),
      ratio: summarizeRatios(ratios),
      expandedCaseCount: categoryRecords.filter((record) => record.ratio !== null && record.ratio >= 1).length,
      markerMissingCount: categoryRecords.reduce((sum, record) => sum + record.marker_missing.length, 0),
    };
  });
}

export function analyzeQualityRecords(sourceRecords) {
  const records = sourceRecords.map(buildCaseRecord);
  const ratios = records.flatMap((record) => record.ratio === null ? [] : [record.ratio]);
  const markerChecks = sourceRecords.flatMap((record) => Array.isArray(record.marker_checks) ? record.marker_checks : []);
  const causeCounts = Object.fromEntries(
    [...new Set(records.flatMap((record) => record.expansion_causes))].sort().map((cause) => [cause, 0]),
  );
  for (const record of records) {
    for (const cause of record.expansion_causes) causeCounts[cause] += 1;
  }

  return {
    caseCount: records.length,
    inputChars: records.reduce((sum, record) => sum + record.input_chars, 0),
    outputChars: records.reduce((sum, record) => sum + record.output_chars, 0),
    totalRatio: records.reduce((sum, record) => sum + record.input_chars, 0) > 0
      ? round(records.reduce((sum, record) => sum + record.output_chars, 0)
        / records.reduce((sum, record) => sum + record.input_chars, 0))
      : null,
    ratio: summarizeRatios(ratios),
    expandedCaseCount: records.filter((record) => record.ratio !== null && record.ratio >= 1).length,
    ratioAtLeastOnePointFiveCount: records.filter((record) => record.ratio !== null && record.ratio >= 1.5).length,
    ratioAtLeastTwoCount: records.filter((record) => record.ratio !== null && record.ratio >= 2).length,
    ratioBelowOneCount: records.filter((record) => record.ratio !== null && record.ratio < 1).length,
    marker: {
      total: markerChecks.length,
      present: markerChecks.filter((check) => check.present === true).length,
      missing: markerChecks.filter((check) => check.present !== true).length,
      missingByCategory: Object.fromEntries(categorySummary(records).map((summary) => [summary.category, summary.markerMissingCount])),
    },
    expansionCauseCounts: causeCounts,
    categories: categorySummary(records),
    records,
  };
}

export async function analyzeQualityArtifact(inputPath = DEFAULT_INPUT_PATH, outputPath = DEFAULT_OUTPUT_PATH) {
  const artifact = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  const analysis = analyzeQualityRecords(artifact.records ?? []);
  const report = {
    schema_version: "semantic-compression-quality-review-v1",
    source_schema_version: artifact.schema_version ?? null,
    profile: artifact.profile ?? null,
    prompt_version: artifact.prompt_version ?? null,
    model: artifact.model ?? null,
    assessment: "mechanical analysis only; semantic classifications require human review",
    ...analysis,
  };
  const resolvedOutputPath = resolve(outputPath);
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

if (process.argv[1]?.endsWith("analyze-compression-baseline.mjs")) {
  try {
    const inputPath = process.env.COMPRESSION_QUALITY_INPUT || DEFAULT_INPUT_PATH;
    const outputPath = process.env.COMPRESSION_QUALITY_REVIEW_OUTPUT || DEFAULT_OUTPUT_PATH;
    const report = await analyzeQualityArtifact(inputPath, outputPath);
    console.log(JSON.stringify({
      event: "compression_quality_review",
      inputFile: resolve(inputPath),
      outputFile: resolve(outputPath),
      caseCount: report.caseCount,
      totalRatio: report.totalRatio,
      expandedCaseCount: report.expandedCaseCount,
      markerMissingCount: report.marker.missing,
      semanticThreshold: null,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "compression quality analysis failed");
    process.exitCode = 1;
  }
}
