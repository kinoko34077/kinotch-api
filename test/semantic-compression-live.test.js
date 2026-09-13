import test from "node:test";
import assert from "node:assert/strict";
import { createCompressionWorkerApp } from "../src/semantic-compression-worker.js";
import { validateCompressionPayload } from "../scripts/smoke-production.mjs";
import { resolveLiveGeminiConfig } from "./semantic-compression-live-config.js";
import { resolveMeasurementIntervalMs, sleep } from "../scripts/measurement-pacing.mjs";

const liveGemini = resolveLiveGeminiConfig(process.env);

(liveGemini.shouldRun ? test : test.skip)("opt-in live Gemini compression preserves both profile contracts", async () => {
  const inputText = "事実: 観測値は10。推測: 原因はZの可能性がある。条件: AならB。";
  const profiles = ["compact-v1", "semantic-dense-v1"];
  const requestIntervalMs = resolveMeasurementIntervalMs(
    process.env,
    "COMPRESSION_LIVE_INTERVAL_MS",
  );
  for (const [index, profile] of profiles.entries()) {
    if (index > 0) await sleep(requestIntervalMs);
    let providerDiagnostic;
    const app = createCompressionWorkerApp({
      onProviderDiagnostic: (diagnostic) => {
        providerDiagnostic = diagnostic;
      },
    });
    const response = await app.request("https://internal.test/v1/compress", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-ID": `live-test-${profile}` },
      body: JSON.stringify({ text: inputText, profile }),
    }, { GEMINI_API_KEY: liveGemini.apiKey });

    if (response.status !== 200) {
      assert.fail(JSON.stringify(providerDiagnostic ?? {
        safeMessage: "Gemini request failed without diagnostic metadata",
      }));
    }
    const payload = await response.json();
    assert.equal(await validateCompressionPayload(payload, inputText, profile), null);
    assert.equal(payload.profile, profile);
    assert.equal(payload.prompt_version, profile);
    assert.ok(Number.isSafeInteger(payload.usage.input_tokens));
    assert.ok(Number.isSafeInteger(payload.usage.output_tokens));
  }
});
