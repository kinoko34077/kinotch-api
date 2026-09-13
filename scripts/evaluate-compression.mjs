import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createCompressionWorkerApp } from "../src/semantic-compression-worker.js";
import {
  COMPRESSION_PROFILE,
  COMPRESSION_PROMPT_VERSION,
  COMPRESSION_MODEL,
} from "../src/semantic-compression/contract.js";
import { COMPRESSION_SYSTEM_INSTRUCTION } from "../src/semantic-compression/prompt.js";
import {
  CANDIDATE_SYSTEM_INSTRUCTION,
  COMPRESSION_CANDIDATE_PROMPT_VERSION,
} from "../src/semantic-compression/prompt-candidate.js";
import { validateCompressionPayload } from "./smoke-production.mjs";
import {
  getSafeRetryAfterSeconds,
  resolveMeasurementIntervalMs,
  sleep,
} from "./measurement-pacing.mjs";

const DEFAULT_CORPUS_URL = new URL("../test/fixtures/semantic-compression-quality.json", import.meta.url);
const EXPECTED_PUBLIC_KEYS = [
  "compressed_text",
  "input_chars",
  "input_sha256",
  "model",
  "output_chars",
  "output_sha256",
  "profile",
  "prompt_version",
  "usage",
  "warnings",
].sort();

export function resolveQualityVariant(name = "control") {
  const variantName = name || "control";
  if (variantName === "control") {
    return {
      name: "control",
      systemInstruction: COMPRESSION_SYSTEM_INSTRUCTION,
      evaluationPromptVersion: COMPRESSION_PROMPT_VERSION,
    };
  }
  if (variantName === "candidate") {
    return {
      name: "candidate",
      systemInstruction: CANDIDATE_SYSTEM_INSTRUCTION,
      evaluationPromptVersion: COMPRESSION_CANDIDATE_PROMPT_VERSION,
    };
  }
  throw new Error("COMPRESSION_QUALITY_PROMPT_VARIANT must be control or candidate");
}

export function composeQualityInput(entry) {
  return `${entry.input}${entry.suffix ?? ""}`;
}

function requireOptInConfiguration(env) {
  if (env.RUN_COMPRESSION_QUALITY_EVAL !== "true") {
    throw new Error("RUN_COMPRESSION_QUALITY_EVAL=true is required");
  }
  if (typeof env.KINOTCH_COMPRESSION_GEMINI_API_KEY !== "string" || env.KINOTCH_COMPRESSION_GEMINI_API_KEY.length === 0) {
    throw new Error("KINOTCH_COMPRESSION_GEMINI_API_KEY is required when RUN_COMPRESSION_QUALITY_EVAL=true");
  }
  return env.KINOTCH_COMPRESSION_GEMINI_API_KEY;
}

function collectMarkerChecks(entry, compressedText) {
  return Object.entries(entry.markers).flatMap(([kind, markers]) => markers.map((marker) => ({
    kind,
    marker,
    present: compressedText.includes(marker),
  })));
}

export async function evaluateQuality({ env = process.env } = {}) {
  const apiKey = requireOptInConfiguration(env);
  const variant = resolveQualityVariant(env.COMPRESSION_QUALITY_PROMPT_VARIANT);
  const requestIntervalMs = resolveMeasurementIntervalMs(
    env,
    "COMPRESSION_QUALITY_INTERVAL_MS",
  );
  const corpusPath = env.COMPRESSION_QUALITY_INPUT;
  const corpus = JSON.parse(await readFile(
    corpusPath ? resolve(corpusPath) : DEFAULT_CORPUS_URL,
    "utf8",
  ));
  const app = createCompressionWorkerApp({ systemInstruction: variant.systemInstruction });
  const records = [];
  let requestsSent = 0;

  for (const entry of corpus) {
    if (requestsSent > 0) {
      await sleep(requestIntervalMs);
    }
    requestsSent += 1;
    const inputText = composeQualityInput(entry);
    const response = await app.request("https://quality-evaluation.test/v1/compress", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": `quality-${entry.id}`,
      },
      body: JSON.stringify({ text: inputText, profile: COMPRESSION_PROFILE }),
    }, { GEMINI_API_KEY: apiKey });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // The safe status record below is sufficient for a malformed response.
    }
    if (response.status !== 200) {
      const retryAfterSeconds = getSafeRetryAfterSeconds(response);
      const retryAfterNote = retryAfterSeconds === null ? "" : `; retry_after_seconds=${retryAfterSeconds}`;
      throw new Error(
        `quality evaluation failed for ${entry.id} with status ${response.status}${retryAfterNote}; no automatic retry`,
      );
    }
    const validationError = await validateCompressionPayload(payload, inputText);
    if (validationError) {
      throw new Error(`quality evaluation contract failed for ${entry.id}: ${validationError}`);
    }
    if (JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(EXPECTED_PUBLIC_KEYS)) {
      throw new Error(`quality evaluation public response changed for ${entry.id}`);
    }

    records.push({
      id: entry.id,
      category: entry.category,
      input: inputText,
      compressed_text: payload.compressed_text,
      provenance: {
        profile: payload.profile,
        prompt_version: payload.prompt_version,
        model: payload.model,
        input_chars: payload.input_chars,
        output_chars: payload.output_chars,
      },
      marker_checks: collectMarkerChecks(entry, payload.compressed_text),
    });
  }

  const markerChecks = records.flatMap((record) => record.marker_checks);
  const report = {
    schema_version: "semantic-compression-quality-baseline-v1",
    profile: COMPRESSION_PROFILE,
    prompt_version: COMPRESSION_PROMPT_VERSION,
    prompt_variant: variant.name,
    evaluation_prompt_version: variant.evaluationPromptVersion,
    model: COMPRESSION_MODEL,
    request_interval_ms: requestIntervalMs,
    case_count: records.length,
    marker_check_count: markerChecks.length,
    marker_present_count: markerChecks.filter((check) => check.present).length,
    records,
    note: "Synthetic baseline for human semantic review; no quality threshold is defined.",
  };
  const outputPath = env.COMPRESSION_QUALITY_OUTPUT;
  if (typeof outputPath === "string" && outputPath.length > 0) {
    const resolvedOutputPath = resolve(outputPath);
    await mkdir(dirname(resolvedOutputPath), { recursive: true });
    await writeFile(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  const summary = {
    event: "compression_quality_baseline",
    caseCount: report.case_count,
    markerCheckCount: report.marker_check_count,
    markerPresentCount: report.marker_present_count,
    markerMissingCount: report.marker_check_count - report.marker_present_count,
    requestIntervalMs,
    outputFile: outputPath ? resolve(outputPath) : null,
    promptVariant: variant.name,
    evaluationPromptVersion: variant.evaluationPromptVersion,
    threshold: null,
  };
  if (env === process.env) console.log(JSON.stringify(summary));
  return report;
}

if (process.argv[1]?.endsWith("evaluate-compression.mjs")) {
  try {
    await evaluateQuality();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "compression quality evaluation failed");
    process.exitCode = 1;
  }
}
