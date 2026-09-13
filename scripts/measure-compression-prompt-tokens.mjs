import {
  COMPRESSION_MODEL,
  COMPRESSION_PROFILE_COMPACT,
  COMPRESSION_PROFILE_SEMANTIC_DENSE,
} from "../src/semantic-compression/contract.js";
import { resolveCompressionProfile } from "../src/semantic-compression/prompt.js";
import { resolveMeasurementIntervalMs, sleep } from "./measurement-pacing.mjs";

export const GEMINI_COUNT_TOKENS_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${COMPRESSION_MODEL}:countTokens`;
export const COMPRESSION_PROMPT_TOKEN_MEASURE_INTERVAL_ENV = "COMPRESSION_PROMPT_TOKEN_MEASURE_INTERVAL_MS";

export function normalizePromptTokenCount(payload) {
  const value = payload?.totalTokens;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export async function countGeminiPromptTokens({
  apiKey,
  profile,
  fetchImpl = globalThis.fetch,
  timeoutMs = 45_000,
} = {}) {
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new Error("KINOTCH_COMPRESSION_GEMINI_API_KEY is required for prompt token measurement");
  }
  const resolved = resolveCompressionProfile(profile);
  if (!resolved) throw new Error("Prompt token measurement requires a supported profile");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(GEMINI_COUNT_TOKENS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [{ text: resolved.systemInstruction }],
          }],
        }),
        signal: controller.signal,
      });
    } catch {
      throw new Error("Gemini prompt token measurement failed");
    }

    if (!response?.ok) throw new Error("Gemini prompt token measurement failed");
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Gemini prompt token measurement failed");
    }
    const systemPromptTokens = normalizePromptTokenCount(payload);
    if (systemPromptTokens === null) throw new Error("Gemini prompt token measurement failed");
    return { systemPromptTokens };
  } finally {
    clearTimeout(timeout);
  }
}

export async function measureCompressionPromptTokens({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (env.RUN_COMPRESSION_PROMPT_TOKEN_MEASURE !== "true") {
    return { status: "skipped" };
  }
  const apiKey = env.KINOTCH_COMPRESSION_GEMINI_API_KEY;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new Error("KINOTCH_COMPRESSION_GEMINI_API_KEY is required when RUN_COMPRESSION_PROMPT_TOKEN_MEASURE=true");
  }

  const intervalMs = resolveMeasurementIntervalMs(env, COMPRESSION_PROMPT_TOKEN_MEASURE_INTERVAL_ENV);
  const profiles = [COMPRESSION_PROFILE_COMPACT, COMPRESSION_PROFILE_SEMANTIC_DENSE];
  const results = [];
  for (const [index, profile] of profiles.entries()) {
    if (index > 0) await sleep(intervalMs);
    const { systemPromptTokens } = await countGeminiPromptTokens({ apiKey, profile, fetchImpl });
    results.push({ profile, model: COMPRESSION_MODEL, systemPromptTokens });
  }
  return { status: "measured", requestIntervalMs: intervalMs, results };
}

if (process.argv[1]?.endsWith("measure-compression-prompt-tokens.mjs")) {
  try {
    console.log(JSON.stringify(await measureCompressionPromptTokens()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Gemini prompt token measurement failed");
    process.exitCode = 1;
  }
}
