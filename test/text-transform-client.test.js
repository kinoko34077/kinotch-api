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

test("text transform client supports batched transformation", async () => {
  const calls = [];
  const client = createTextTransformClient({
    baseUrl: "https://api.example.test",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ texts: ["學校", "國"] }), { status: 200 });
    },
  });

  assert.deepEqual(await client.transformBatch(["学校", "国"], {
    profile: ["legacy-kanji"],
  }), { texts: ["學校", "國"] });
  assert.equal(calls[0].url, "https://api.example.test/v1/transform/batch");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    texts: ["学校", "国"],
    profile: ["legacy-kanji"],
  });
});

test("text transform client aborts stalled requests and uses fallback", async () => {
  const client = createTextTransformClient({
    timeoutMs: 10,
    fetchImpl: (_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
    fallback: {
      transform: (_text, _options, error) => ({
        text: "学校:local",
        fallbackCode: error?.code,
      }),
    },
  });

  assert.deepEqual(await client.transform("学校", { profile: ["legacy-kanji"] }), {
    text: "学校:local",
    fallbackCode: "request_failed",
  });
});

test("text transform client falls back when the API rule set hash differs", async () => {
  const expectedRuleSetHash = "a".repeat(64);
  const client = createTextTransformClient({
    expectedRuleSetHash,
    fetchImpl: async () => new Response(JSON.stringify({
      texts: ["學校"],
      ruleSetHash: "b".repeat(64),
    }), { status: 200 }),
    fallback: {
      transformBatch: (_texts, _options, error) => ({
        texts: ["学校"],
        fallbackCode: error.code,
        expected: error.details.expected,
        received: error.details.received,
      }),
    },
  });

  assert.deepEqual(await client.transformBatch(["学校"], { profile: ["legacy-kanji"] }), {
    texts: ["学校"],
    fallbackCode: "rule_set_mismatch",
    expected: expectedRuleSetHash,
    received: "b".repeat(64),
  });
});

test("text transform client falls back when the API snapshot hash differs", async () => {
  const expectedSnapshotHash = "a".repeat(64);
  const client = createTextTransformClient({
    expectedSnapshotHash,
    fetchImpl: async () => new Response(JSON.stringify({
      text: "學校",
      snapshotHash: "b".repeat(64),
    }), { status: 200 }),
    fallback: {
      transform: (_text, _options, error) => ({
        text: "学校",
        fallbackCode: error.code,
        expected: error.details.expected,
        received: error.details.received,
      }),
    },
  });

  assert.deepEqual(await client.transform("学校", { profile: ["legacy-kanji"] }), {
    text: "学校",
    fallbackCode: "snapshot_mismatch",
    expected: expectedSnapshotHash,
    received: "b".repeat(64),
  });
});

test("text transform client retries transient failures once", async () => {
  let attempts = 0;
  const client = createTextTransformClient({
    retryBaseDelayMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: "temporary" }), { status: 503 });
      }
      return new Response(JSON.stringify({ text: "學校" }), { status: 200 });
    },
  });

  assert.deepEqual(await client.transform("学校", { profile: ["legacy-kanji"] }), {
    text: "學校",
  });
  assert.equal(attempts, 2);
});

test("text transform client does not retry a rate limit without Retry-After", async () => {
  let attempts = 0;
  const client = createTextTransformClient({
    fetchImpl: async () => {
      attempts += 1;
      return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 });
    },
  });

  await assert.rejects(
    client.transform("学校", { profile: ["legacy-kanji"] }),
    (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.code, "rate_limited");
      return true;
    },
  );
  assert.equal(attempts, 1);
});

test("text transform client obeys Retry-After before retrying a rate limit", async () => {
  let attempts = 0;
  const delays = [];
  const client = createTextTransformClient({
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429,
          headers: { "Retry-After": "0.05" },
        });
      }
      return new Response(JSON.stringify({ text: "學校" }), { status: 200 });
    },
    sleepImpl: async (milliseconds) => delays.push(milliseconds),
  });

  assert.deepEqual(await client.transform("学校", { profile: ["legacy-kanji"] }), {
    text: "學校",
  });
  assert.deepEqual(delays, [50]);
  assert.equal(attempts, 2);
});

test("text transform client rejects malformed successful responses and falls back", async () => {
  const client = createTextTransformClient({
    maxRetries: 0,
    fetchImpl: async () => new Response(JSON.stringify({ texts: ["學校"] }), { status: 200 }),
    fallback: {
      transform: (_text, _options, error) => ({ fallbackCode: error.code }),
    },
  });

  assert.deepEqual(await client.transform("学校", { profile: ["legacy-kanji"] }), {
    fallbackCode: "invalid_response",
  });
});
