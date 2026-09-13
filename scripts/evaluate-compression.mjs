import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createCompressionWorkerApp } from "../src/semantic-compression-worker.js";
import {
  COMPRESSION_PROFILE,
  COMPRESSION_PROMPT_VERSION,
  COMPRESSION_MODEL,
} from "../src/semantic-compression/contract.js";
import { validateCompressionPayload } from "./smoke-production.mjs";

const CORPUS_URL = new URL("../test/fixtures/semantic-compression-quality.json", import.meta.url);
const EXPECTED_PUBLIC_KEYS = [
  "compressed_text",
  "input_chars",
  "input_sha256",
  "model",
  "output_chars",
  "output_sha256",
  "profile",
  "prompt_version",
  "warnings",
].sort();

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

async function evaluate() {
  const apiKey = requireOptInConfiguration(process.env);
  const corpus = JSON.parse(await readFile(CORPUS_URL, "utf8"));
  const app = createCompressionWorkerApp();
  const records = [];

  for (const entry of corpus) {
    const response = await app.request("https://quality-evaluation.test/v1/compress", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": `quality-${entry.id}`,
      },
      body: JSON.stringify({ text: entry.input, profile: COMPRESSION_PROFILE }),
    }, { GEMINI_API_KEY: apiKey });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // The safe status record below is sufficient for a malformed response.
    }
    if (response.status !== 200) {
      throw new Error(`quality evaluation failed for ${entry.id} with status ${response.status}`);
    }
    const validationError = await validateCompressionPayload(payload, entry.input);
    if (validationError) {
      throw new Error(`quality evaluation contract failed for ${entry.id}: ${validationError}`);
    }
    if (JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(EXPECTED_PUBLIC_KEYS)) {
      throw new Error(`quality evaluation public response changed for ${entry.id}`);
    }

    records.push({
      id: entry.id,
      category: entry.category,
      input: entry.input,
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
    model: COMPRESSION_MODEL,
    case_count: records.length,
    marker_check_count: markerChecks.length,
    marker_present_count: markerChecks.filter((check) => check.present).length,
    records,
    note: "Synthetic baseline for human semantic review; no quality threshold is defined.",
  };
  const outputPath = process.env.COMPRESSION_QUALITY_OUTPUT;
  if (typeof outputPath === "string" && outputPath.length > 0) {
    const resolvedOutputPath = resolve(outputPath);
    await mkdir(dirname(resolvedOutputPath), { recursive: true });
    await writeFile(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify({
    event: "compression_quality_baseline",
    caseCount: report.case_count,
    markerCheckCount: report.marker_check_count,
    markerPresentCount: report.marker_present_count,
    markerMissingCount: report.marker_check_count - report.marker_present_count,
    outputFile: outputPath ? resolve(outputPath) : null,
    threshold: null,
  }));
}

try {
  await evaluate();
} catch (error) {
  console.error(error instanceof Error ? error.message : "compression quality evaluation failed");
  process.exitCode = 1;
}
