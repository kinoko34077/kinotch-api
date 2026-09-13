import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeInteractionUsage,
} from "../src/semantic-compression/gemini.js";
import { createCompressionWorkerApp } from "../src/semantic-compression-worker.js";
import {
  USAGE_MEASUREMENT_SCENARIOS,
  buildUsageMeasurementOutput,
  resolveUsageVariant,
} from "../scripts/measure-compression-usage.mjs";
import { COMPRESSION_CANDIDATE_PROMPT_VERSION } from "../src/semantic-compression/prompt-candidate.js";

const API_KEY = "<fixture-gemini-key>";

function requestBody(body) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function completedResponse(usage) {
  return new Response(JSON.stringify({
    status: "completed",
    usage,
    steps: [{
      type: "model_output",
      content: [{ type: "text", text: "要点\n- 結果" }],
    }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("normalizes documented Interaction usage fields to safe numeric values", () => {
  assert.deepEqual(normalizeInteractionUsage({
    total_input_tokens: 1234,
    total_output_tokens: 321,
    total_thought_tokens: 7,
    total_cached_tokens: 600,
    total_tokens: 1562,
  }), {
    inputTokens: 1234,
    outputTokens: 321,
    thoughtTokens: 7,
    cachedTokens: 600,
    totalTokens: 1562,
  });
});

test("normalizes missing and malformed Interaction usage fields to null", () => {
  assert.deepEqual(normalizeInteractionUsage({
    total_input_tokens: "1234",
    total_output_tokens: -1,
    total_thought_tokens: 1.5,
    total_cached_tokens: Number.POSITIVE_INFINITY,
  }), {
    inputTokens: null,
    outputTokens: null,
    thoughtTokens: null,
    cachedTokens: null,
    totalTokens: null,
  });
  assert.deepEqual(normalizeInteractionUsage(undefined), {
    inputTokens: null,
    outputTokens: null,
    thoughtTokens: null,
    cachedTokens: null,
    totalTokens: null,
  });
});

test("Worker sends usage only to an injected observer, never to the public response", async () => {
  let observedUsage;
  const app = createCompressionWorkerApp({
    onUsage: (usage) => { observedUsage = usage; },
    fetchImpl: async () => completedResponse({
      total_input_tokens: 100,
      total_output_tokens: 20,
      total_thought_tokens: 2,
      total_cached_tokens: 30,
      total_tokens: 122,
    }),
  });

  const response = await app.request(
    "https://internal.test/v1/compress",
    requestBody({ text: "原文", profile: "semantic-dense-v1" }),
    { GEMINI_API_KEY: API_KEY },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(observedUsage, {
    inputTokens: 100,
    outputTokens: 20,
    thoughtTokens: 2,
    cachedTokens: 30,
    totalTokens: 122,
  });
  const body = await response.json();
  assert.equal(body.usage, undefined);
  assert.deepEqual(Object.keys(body).sort(), [
    "compressed_text",
    "input_chars",
    "input_sha256",
    "model",
    "output_chars",
    "output_sha256",
    "profile",
    "prompt_version",
    "warnings",
  ].sort());
});

test("usage measurement separates system-only and shared-input-prefix scenarios", () => {
  assert.deepEqual(USAGE_MEASUREMENT_SCENARIOS.map((scenario) => scenario.name), [
    "system-only",
    "shared-input-prefix",
  ]);

  const output = buildUsageMeasurementOutput([
    {
      scenario: "system-only",
      index: 1,
      status: 200,
      inputChars: 10,
      outputChars: 5,
      usage: { inputTokens: 20, outputTokens: 5, thoughtTokens: 0, cachedTokens: 3, totalTokens: 25 },
      inputText: "synthetic secret text",
      compressedText: "synthetic compressed text",
    },
    {
      scenario: "shared-input-prefix",
      index: 1,
      status: 200,
      inputChars: 100,
      outputChars: 40,
      usage: { inputTokens: 120, outputTokens: 10, thoughtTokens: 2, cachedTokens: 80, totalTokens: 132 },
      inputText: "another synthetic secret text",
      compressedText: "another synthetic compressed text",
    },
  ]);

  assert.equal(output.scenarioSummary[0].cachedTokens.values[0], 3);
  assert.equal(output.scenarioSummary[1].cachedTokens.values[0], 80);
  assert.equal(output.requestIntervalMs, null);
  assert.equal(output.records[0].scenario, "system-only");
  assert.equal(output.records[1].scenario, "shared-input-prefix");
  assert.doesNotMatch(JSON.stringify(output), /synthetic secret text|compressed text/);
});

test("usage measurement can select the internal candidate prompt without exposing prompt text", () => {
  const variant = resolveUsageVariant("candidate");
  assert.equal(variant.name, "candidate");
  assert.equal(variant.evaluationPromptVersion, COMPRESSION_CANDIDATE_PROMPT_VERSION);

  const output = buildUsageMeasurementOutput([], {
    requestIntervalMs: 15000,
    promptVariant: variant.name,
    evaluationPromptVersion: variant.evaluationPromptVersion,
  });

  assert.equal(output.promptVariant, "candidate");
  assert.equal(output.evaluationPromptVersion, COMPRESSION_CANDIDATE_PROMPT_VERSION);
  assert.doesNotMatch(JSON.stringify(output), /意味保存|圧縮対象データ/);
});
