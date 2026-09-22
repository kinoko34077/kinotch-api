import test from "node:test";
import assert from "node:assert/strict";
import { callCompressionService } from "../src/semantic-compression-mcp/upstream.js";

function validPayload(overrides = {}) {
  return {
    compressed_text: "圧縮結果",
    profile: "semantic-dense-v1",
    prompt_version: "semantic-dense-v1",
    model: "gemini-3.5-flash-lite",
    input_chars: 2,
    output_chars: 4,
    warnings: [],
    ...overrides,
  };
}

function bindingResponse(status, body) {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("binding adapter sends fixed profile without Authorization and returns safe payload", async () => {
  let request;
  const result = await callCompressionService({
      COMPRESSION: {
      fetch: async (input) => {
        request = { input: input.url, init: input, body: await input.json() };
        return bindingResponse(200, validPayload());
      },
    },
  }, "本文");

  assert.equal(request.input, "https://semantic-compression.internal/v1/compress");
  assert.equal(request.init.headers.get("Authorization"), null);
  assert.deepEqual(request.body, { text: "本文", profile: "semantic-dense-v1" });
  assert.deepEqual(result, validPayload());
});

test("binding adapter maps status failures without exposing raw body", async (t) => {
  for (const [status, code] of [[400, "invalid_input"], [413, "payload_too_large"], [429, "rate_limited"], [500, "compression_unavailable"]]) {
    await t.test(String(status), async () => {
      const secret = "raw-upstream-secret";
      await assert.rejects(
        callCompressionService({ COMPRESSION: { fetch: async () => bindingResponse(status, { secret }) } }, "本文"),
        (error) => error.code === code && !error.message.includes(secret),
      );
    });
  }
});

test("binding adapter maps timeout and does not retry", async () => {
  let calls = 0;
  await assert.rejects(
    callCompressionService({
      COMPRESSION: {
        fetch: async (input) => new Promise((_resolve, reject) => {
          calls += 1;
          input.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
      },
    }, "本文", { timeoutMs: 5 }),
    (error) => error.code === "compression_timeout",
  );
  assert.equal(calls, 1);
});

test("binding adapter rejects malformed or unsafe successful responses", async (t) => {
  for (const [name, body] of [
    ["invalid json", "not-json"],
    ["empty text", validPayload({ compressed_text: "" })],
    ["wrong profile", validPayload({ profile: "compact-v1" })],
    ["wrong prompt version", validPayload({ prompt_version: "other-version" })],
    ["mismatched input count", validPayload({ input_chars: 4 })],
    ["mismatched output count", validPayload({ output_chars: 3 })],
    ["invalid count", validPayload({ output_chars: -1 })],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(
        callCompressionService({
          COMPRESSION: {
            fetch: async () => body === "not-json"
              ? new Response(body, { status: 200 })
              : bindingResponse(200, body),
          },
        }, "本文"),
        (error) => error.code === "invalid_upstream_response",
      );
    });
  }
});
