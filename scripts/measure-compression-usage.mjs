import { createCompressionWorkerApp } from "../src/semantic-compression-worker.js";
import {
  COMPRESSION_PROFILE,
  COMPRESSION_MODEL,
} from "../src/semantic-compression/contract.js";
import { validateCompressionPayload } from "./smoke-production.mjs";

function requireOptInConfiguration(env) {
  if (env.RUN_COMPRESSION_USAGE_MEASURE !== "true") {
    throw new Error("RUN_COMPRESSION_USAGE_MEASURE=true is required");
  }
  if (typeof env.KINOTCH_COMPRESSION_GEMINI_API_KEY !== "string" || env.KINOTCH_COMPRESSION_GEMINI_API_KEY.length === 0) {
    throw new Error("KINOTCH_COMPRESSION_GEMINI_API_KEY is required when RUN_COMPRESSION_USAGE_MEASURE=true");
  }
  return env.KINOTCH_COMPRESSION_GEMINI_API_KEY;
}

const commonPrefix = "評価用共通prefix: 同じ本文接頭辞を複数回使い、stateless Interactionsのusageだけを観測する。\n".repeat(160);
const cases = [
  `${commonPrefix}差分A: 数値は11。`,
  `${commonPrefix}差分B: 数値は22。`,
  `${commonPrefix}差分C: 条件Aなら結果C。`,
  `${commonPrefix}差分D: 例外として結果D。`,
];

async function measure() {
  const apiKey = requireOptInConfiguration(process.env);
  const observations = [];
  const app = createCompressionWorkerApp({
    onUsage: (usage) => { observations.push(usage); },
  });

  const records = [];
  for (let index = 0; index < cases.length; index += 1) {
    const inputText = cases[index];
    const observationIndex = observations.length;
    const response = await app.request("https://usage-measurement.test/v1/compress", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": `usage-measure-${index + 1}`,
      },
      body: JSON.stringify({ text: inputText, profile: COMPRESSION_PROFILE }),
    }, { GEMINI_API_KEY: apiKey });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Status-only failure below avoids exposing any provider response body.
    }
    if (response.status !== 200) {
      throw new Error(`usage measurement request ${index + 1} failed with status ${response.status}`);
    }
    const validationError = await validateCompressionPayload(payload, inputText);
    if (validationError) {
      throw new Error(`usage measurement contract failed for request ${index + 1}: ${validationError}`);
    }

    records.push({
      index: index + 1,
      model: COMPRESSION_MODEL,
      inputChars: payload.input_chars,
      outputChars: payload.output_chars,
      usage: observations[observationIndex] ?? null,
    });
  }

  console.log(JSON.stringify({
    event: "compression_usage_measurement",
    requestCount: records.length,
    stateless: true,
    explicitCache: false,
    records,
  }));
}

try {
  await measure();
} catch (error) {
  console.error(error instanceof Error ? error.message : "compression usage measurement failed");
  process.exitCode = 1;
}
