import test from "node:test";
import assert from "node:assert/strict";
import {
  countGeminiPromptTokens,
  normalizePromptTokenCount,
} from "../scripts/measure-compression-prompt-tokens.mjs";
import { resolveCompressionProfile } from "../src/semantic-compression/prompt.js";

const API_KEY = "<fixture-gemini-key>";

test("countTokens request uses the fixed model and system instruction only", async () => {
  const result = await countGeminiPromptTokens({
    apiKey: API_KEY,
    profile: "compact-v1",
    fetchImpl: async (input, init) => {
      assert.equal(input, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:countTokens");
      assert.equal(init.headers["x-goog-api-key"], API_KEY);
      const body = JSON.parse(init.body);
      assert.deepEqual(Object.keys(body), ["contents"]);
      assert.deepEqual(body.contents, [{
        role: "user",
        parts: [{ text: resolveCompressionProfile("compact-v1").systemInstruction }],
      }]);
      return new Response(JSON.stringify({ totalTokens: 123 }), { status: 200 });
    },
  });

  assert.deepEqual(result, { systemPromptTokens: 123 });
});

test("countTokens rejects malformed counts without exposing provider data", async () => {
  assert.equal(normalizePromptTokenCount({ totalTokens: 0 }), 0);
  assert.equal(normalizePromptTokenCount({ totalTokens: -1 }), null);
  assert.equal(normalizePromptTokenCount({ totalTokens: "123" }), null);
  await assert.rejects(
    () => countGeminiPromptTokens({
      apiKey: API_KEY,
      profile: "semantic-dense-v1",
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: API_KEY } }), { status: 400 }),
    }),
    (error) => {
      assert.equal(error.message, "Gemini prompt token measurement failed");
      assert.doesNotMatch(error.message, /fixture-gemini-key/);
      return true;
    },
  );
});
