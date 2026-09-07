import test from "node:test";
import assert from "node:assert/strict";
import {
  createTextTransformClient,
  TextTransformApiError,
} from "../src/client/text-transform.js";

test("text transform client sends the shared request contract", async () => {
  const calls = [];
  const client = createTextTransformClient({
    baseUrl: "https://api.example.test/",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ text: "學校" }), { status: 200 });
    },
  });

  const result = await client.transform("学校", { profile: ["legacy-kanji"] });
  assert.deepEqual(result, { text: "學校" });
  assert.equal(calls[0].url, "https://api.example.test/v1/transform");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    text: "学校",
    profile: ["legacy-kanji"],
  });
});

test("text transform client exposes structured API errors", async () => {
  const client = createTextTransformClient({
    fetchImpl: async () => new Response(JSON.stringify({
      error: "tokenizer_unavailable",
      message: "Tokenizer assets could not be loaded",
      details: ["okurigana-abbreviation"],
    }), { status: 503 }),
  });

  await assert.rejects(
    client.parseRuby("本文"),
    (error) => {
      assert.ok(error instanceof TextTransformApiError);
      assert.equal(error.status, 503);
      assert.equal(error.code, "tokenizer_unavailable");
      assert.deepEqual(error.details, ["okurigana-abbreviation"]);
      return true;
    },
  );
});

test("text transform client uses fallback only for server failures", async () => {
  const client = createTextTransformClient({
    fetchImpl: async () => new Response(JSON.stringify({
      error: "tokenizer_unavailable",
      message: "Tokenizer assets could not be loaded",
    }), { status: 503 }),
    fallback: {
      transform: (text, options, error) => ({
        text: `${text}:local`,
        profile: options.profile,
        fallbackStatus: error.status,
      }),
    },
  });

  assert.deepEqual(await client.transform("学校", { profile: ["legacy-kanji"] }), {
    text: "学校:local",
    profile: ["legacy-kanji"],
    fallbackStatus: 503,
  });
});
