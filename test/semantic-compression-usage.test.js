import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeInteractionUsage,
} from "../src/semantic-compression/gemini.js";
import { createCompressionWorkerApp } from "../src/semantic-compression-worker.js";

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
