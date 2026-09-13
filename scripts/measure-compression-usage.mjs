import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createCompressionWorkerApp } from "../src/semantic-compression-worker.js";
import {
  COMPRESSION_PROFILE,
  COMPRESSION_MODEL,
} from "../src/semantic-compression/contract.js";
import { validateCompressionPayload } from "./smoke-production.mjs";
import { resolveQualityVariant } from "./evaluate-compression.mjs";
import {
  getSafeRetryAfterSeconds,
  resolveMeasurementIntervalMs,
  sleep,
} from "./measurement-pacing.mjs";

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

export const USAGE_MEASUREMENT_SCENARIOS = [
  {
    name: "system-only",
    cases: [
      "観測値は11。原因は未確認。",
      "東京の待ち時間は7分だった。",
      "条件Xなら処理Yを実行する。",
      "例外Zでは保存しない。",
    ],
  },
  {
    name: "shared-input-prefix",
    cases: [
      `${commonPrefix}差分A: 数値は11。`,
      `${commonPrefix}差分B: 数値は22。`,
      `${commonPrefix}差分C: 条件Aなら結果C。`,
      `${commonPrefix}差分D: 例外として結果D。`,
    ],
  },
];

export function resolveUsageVariant(name = process.env.COMPRESSION_USAGE_PROMPT_VARIANT) {
  return resolveQualityVariant(name);
}

function summarizeNumbers(values) {
  const observed = values.filter((value) => Number.isSafeInteger(value) && value >= 0);
  return {
    values,
    observedCount: observed.length,
    zeroCount: observed.filter((value) => value === 0).length,
    min: observed.length > 0 ? Math.min(...observed) : null,
    max: observed.length > 0 ? Math.max(...observed) : null,
    average: observed.length > 0
      ? Number((observed.reduce((sum, value) => sum + value, 0) / observed.length).toFixed(2))
      : null,
  };
}

export function buildUsageMeasurementOutput(records, {
  requestIntervalMs = null,
  promptVariant = "control",
  evaluationPromptVersion = null,
} = {}) {
  const safeRecords = records.map((record) => ({
    scenario: record.scenario,
    index: record.index,
    status: record.status,
    model: record.model,
    inputChars: record.inputChars,
    outputChars: record.outputChars,
    usage: record.usage,
  }));
  const summary = USAGE_MEASUREMENT_SCENARIOS.map(({ name }) => {
    const scenarioRecords = safeRecords.filter((record) => record.scenario === name);
    return {
      scenario: name,
      requestCount: scenarioRecords.length,
      inputChars: summarizeNumbers(scenarioRecords.map((record) => record.inputChars)),
      outputChars: summarizeNumbers(scenarioRecords.map((record) => record.outputChars)),
      inputTokens: summarizeNumbers(scenarioRecords.map((record) => record.usage?.inputTokens ?? null)),
      outputTokens: summarizeNumbers(scenarioRecords.map((record) => record.usage?.outputTokens ?? null)),
      thoughtTokens: summarizeNumbers(scenarioRecords.map((record) => record.usage?.thoughtTokens ?? null)),
      cachedTokens: summarizeNumbers(scenarioRecords.map((record) => record.usage?.cachedTokens ?? null)),
      totalTokens: summarizeNumbers(scenarioRecords.map((record) => record.usage?.totalTokens ?? null)),
    };
  });

  return {
    event: "compression_usage_measurement",
    model: COMPRESSION_MODEL,
    promptVariant,
    evaluationPromptVersion,
    requestIntervalMs,
    stateless: true,
    explicitCache: false,
    scenarioSummary: summary,
    records: safeRecords,
  };
}

async function measure() {
  const apiKey = requireOptInConfiguration(process.env);
  const requestIntervalMs = resolveMeasurementIntervalMs(
    process.env,
    "COMPRESSION_USAGE_INTERVAL_MS",
  );
  const variant = resolveUsageVariant(process.env.COMPRESSION_USAGE_PROMPT_VARIANT);
  let currentUsage = null;
  const app = createCompressionWorkerApp({
    onUsage: (usage) => { currentUsage = usage; },
    systemInstruction: variant.systemInstruction,
  });

  const records = [];
  let requestsSent = 0;
  for (const scenario of USAGE_MEASUREMENT_SCENARIOS) {
    for (let index = 0; index < scenario.cases.length; index += 1) {
      if (requestsSent > 0) {
        await sleep(requestIntervalMs);
      }
      requestsSent += 1;
      const inputText = scenario.cases[index];
      currentUsage = null;
      const response = await app.request("https://usage-measurement.test/v1/compress", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": `usage-${scenario.name}-${index + 1}`,
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
        const retryAfterSeconds = getSafeRetryAfterSeconds(response);
        const retryAfterNote = retryAfterSeconds === null ? "" : `; retry_after_seconds=${retryAfterSeconds}`;
        throw new Error(
          `usage measurement ${scenario.name} request ${index + 1} failed with status ${response.status}${retryAfterNote}; no automatic retry`,
        );
      }
      const validationError = await validateCompressionPayload(payload, inputText);
      if (validationError) {
        throw new Error(`usage measurement ${scenario.name} contract failed for request ${index + 1}: ${validationError}`);
      }
      if (!payload.usage || typeof payload.usage !== "object" || Array.isArray(payload.usage)) {
        throw new Error(`usage measurement public response is missing usage for ${scenario.name} request ${index + 1}`);
      }

      records.push({
        scenario: scenario.name,
        index: index + 1,
        status: response.status,
        model: COMPRESSION_MODEL,
        inputChars: payload.input_chars,
        outputChars: payload.output_chars,
        usage: {
          inputTokens: payload.usage.input_tokens,
          outputTokens: payload.usage.output_tokens,
          thoughtTokens: payload.usage.thought_tokens,
          cachedTokens: payload.usage.cached_tokens,
          totalTokens: payload.usage.total_tokens,
        },
      });
    }
  }

  const output = buildUsageMeasurementOutput(records, {
    requestIntervalMs,
    promptVariant: variant.name,
    evaluationPromptVersion: variant.evaluationPromptVersion,
  });
  const outputPath = process.env.COMPRESSION_USAGE_OUTPUT;
  if (typeof outputPath === "string" && outputPath.length > 0) {
    const resolvedOutputPath = resolve(outputPath);
    await mkdir(dirname(resolvedOutputPath), { recursive: true });
    await writeFile(resolvedOutputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(output));
}

if (process.argv[1]?.endsWith("measure-compression-usage.mjs")) {
  try {
    await measure();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "compression usage measurement failed");
    process.exitCode = 1;
  }
}
