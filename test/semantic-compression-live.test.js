import test from "node:test";
import assert from "node:assert/strict";
import { createCompressionWorkerApp } from "../src/semantic-compression-worker.js";
import { validateCompressionPayload } from "../scripts/smoke-production.mjs";
import { resolveLiveGeminiConfig } from "./semantic-compression-live-config.js";

const liveGemini = resolveLiveGeminiConfig(process.env);

(liveGemini.shouldRun ? test : test.skip)("opt-in live Gemini compression preserves the response contract", async () => {
  const inputText = "事実: 観測値は10。推測: 原因はZの可能性がある。条件: AならB。";
  const app = createCompressionWorkerApp();
  const response = await app.request("https://internal.test/v1/compress", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-ID": "live-test" },
    body: JSON.stringify({ text: inputText, profile: "semantic-dense-v1" }),
  }, { GEMINI_API_KEY: liveGemini.apiKey });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(await validateCompressionPayload(payload, inputText), null);
});
