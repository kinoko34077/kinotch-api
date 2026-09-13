import test from "node:test";
import assert from "node:assert/strict";
import { resolveLiveGeminiConfig } from "./semantic-compression-live-config.js";

test("live test prefers the dedicated compression key when both keys exist", () => {
  assert.deepEqual(
    resolveLiveGeminiConfig({
      RUN_GEMINI_LIVE_TEST: "true",
      GEMINI_API_KEY: "dev-agent-fixture",
      KINOTCH_COMPRESSION_GEMINI_API_KEY: "compression-fixture",
    }),
    { shouldRun: true, apiKey: "compression-fixture" },
  );
});

test("live test ignores the old key and fails fast when the dedicated key is absent", () => {
  assert.throws(
    () => resolveLiveGeminiConfig({
      RUN_GEMINI_LIVE_TEST: "true",
      GEMINI_API_KEY: "dev-agent-fixture",
    }),
    {
      message: "KINOTCH_COMPRESSION_GEMINI_API_KEY is required when RUN_GEMINI_LIVE_TEST=true",
    },
  );
});

test("live test is disabled without the explicit flag", () => {
  assert.deepEqual(
    resolveLiveGeminiConfig({
      KINOTCH_COMPRESSION_GEMINI_API_KEY: "compression-fixture",
    }),
    { shouldRun: false, apiKey: undefined },
  );
});
