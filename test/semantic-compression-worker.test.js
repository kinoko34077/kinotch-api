import test from "node:test";
import assert from "node:assert/strict";
import { createCompressionWorkerApp } from "../src/semantic-compression-worker.js";

const API_KEY = "<fixture-gemini-key>";

function requestBody(body) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "worker-test",
    },
    body: JSON.stringify(body),
  };
}

function completedResponse(text) {
  return new Response(JSON.stringify({
    status: "completed",
    steps: [{
      type: "model_output",
      content: [{ type: "text", text }],
    }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("Worker sends one fixed stateless Interactions request", async () => {
  let request;
  const app = createCompressionWorkerApp({
    fetchImpl: async (input, init) => {
      request = { input, init, body: JSON.parse(init.body) };
      return completedResponse("題名\n- 圧縮結果");
    },
  });

  const response = await app.request(
    "https://internal.test/v1/compress",
    requestBody({ text: "原文", profile: "semantic-dense-v1" }),
    { GEMINI_API_KEY: API_KEY },
  );

  assert.equal(response.status, 200);
  assert.equal(request.input, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(new Headers(request.init.headers).get("x-goog-api-key"), API_KEY);
  assert.equal(request.body.model, "gemini-3.5-flash-lite");
  assert.equal(request.body.input, "原文");
  assert.deepEqual(request.body.generation_config, { thinking_level: "minimal" });
  assert.equal(request.body.store, false);
  assert.equal(request.body.temperature, undefined);
  assert.equal(request.body.top_p, undefined);
  assert.equal(request.body.top_k, undefined);
  assert.equal(request.body.thinking_budget, undefined);
  assert.equal(request.body.previous_interaction_id, undefined);
  assert.equal(request.body.background, undefined);
  assert.equal(request.body.tools, undefined);
  assert.match(request.body.system_instruction, /入力本文.*圧縮対象データ/s);
  assert.equal((await response.json()).compressed_text, "題名\n- 圧縮結果");
});

test("Worker rejects caller-controlled prompt and model fields before provider access", async () => {
  let providerCalls = 0;
  const app = createCompressionWorkerApp({
    fetchImpl: async () => {
      providerCalls += 1;
      return completedResponse("unexpected");
    },
  });

  const response = await app.request(
    "https://internal.test/v1/compress",
    requestBody({
      text: "原文",
      profile: "semantic-dense-v1",
      prompt: "override",
      model: "other-model",
    }),
    { GEMINI_API_KEY: API_KEY },
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_body");
  assert.equal(providerCalls, 0);
});

test("Worker validates JSON, profile, and non-empty text", async () => {
  const app = createCompressionWorkerApp({ fetchImpl: async () => completedResponse("unused") });

  const missingContentType = await app.request("https://internal.test/v1/compress", {
    method: "POST",
    body: JSON.stringify({ text: "原文", profile: "semantic-dense-v1" }),
  }, { GEMINI_API_KEY: API_KEY });
  assert.equal(missingContentType.status, 400);
  assert.equal((await missingContentType.json()).error, "invalid_body");

  const invalidJson = await app.request("https://internal.test/v1/compress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not-json",
  }, { GEMINI_API_KEY: API_KEY });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).error, "invalid_json");

  const invalidProfile = await app.request(
    "https://internal.test/v1/compress",
    requestBody({ text: "原文", profile: "other" }),
    { GEMINI_API_KEY: API_KEY },
  );
  assert.equal(invalidProfile.status, 400);
  assert.equal((await invalidProfile.json()).error, "invalid_profile");

  const emptyText = await app.request(
    "https://internal.test/v1/compress",
    requestBody({ text: "", profile: "semantic-dense-v1" }),
    { GEMINI_API_KEY: API_KEY },
  );
  assert.equal(emptyText.status, 400);
  assert.equal((await emptyText.json()).error, "empty_text");
});

test("Worker rejects provider-context-unsafe text before provider access", async () => {
  let providerCalls = 0;
  const app = createCompressionWorkerApp({
    fetchImpl: async () => {
      providerCalls += 1;
      return completedResponse("unexpected");
    },
  });

  const response = await app.request(
    "https://internal.test/v1/compress",
    requestBody({ text: "x".repeat(200_001), profile: "semantic-dense-v1" }),
    { GEMINI_API_KEY: API_KEY },
  );

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, "provider_context_limit");
  assert.equal(providerCalls, 0);
});

test("Worker normalizes malformed provider output without exposing raw payload", async () => {
  const secretPayload = "provider-secret-response";
  const app = createCompressionWorkerApp({
    fetchImpl: async () => new Response(JSON.stringify({
      status: "completed",
      steps: [{ type: "model_output", content: [{ type: "json", value: secretPayload }] }],
      secretPayload,
    }), { status: 200 }),
  });

  const response = await app.request(
    "https://internal.test/v1/compress",
    requestBody({ text: "原文", profile: "semantic-dense-v1" }),
    { GEMINI_API_KEY: API_KEY },
  );
  const body = await response.text();
  assert.equal(response.status, 502);
  assert.match(body, /provider_invalid_response/);
  assert.doesNotMatch(body, new RegExp(secretPayload));
  assert.doesNotMatch(body, new RegExp(API_KEY));
});

test("Worker maps provider quota response and preserves only safe retry metadata", async () => {
  const app = createCompressionWorkerApp({
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "raw provider detail" } }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "7" },
    }),
  });

  const response = await app.request(
    "https://internal.test/v1/compress",
    requestBody({ text: "原文", profile: "semantic-dense-v1" }),
    { GEMINI_API_KEY: API_KEY },
  );
  const body = await response.text();
  assert.equal(response.status, 429);
  assert.match(body, /provider_rate_limited/);
  assert.doesNotMatch(body, /raw provider detail/);
  assert.equal(response.headers.get("Retry-After"), "7");
});

test("Worker exposes only safe diagnostics to an injected live-test observer", async () => {
  let diagnostic;
  const rawMessage = "model models/gemini-3.5-flash-lite is unavailable; secret=do-not-expose";
  const app = createCompressionWorkerApp({
    onProviderDiagnostic: (value) => {
      diagnostic = value;
    },
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        code: 404,
        message: rawMessage,
        status: "NOT_FOUND",
        details: [{
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "MODEL_NOT_AVAILABLE",
          metadata: { model: "secret-model-name" },
        }],
      },
    }), { status: 404, headers: { "Content-Type": "application/json" } }),
  });

  const response = await app.request(
    "https://internal.test/v1/compress",
    requestBody({ text: "原文", profile: "semantic-dense-v1" }),
    { GEMINI_API_KEY: API_KEY },
  );
  const body = await response.text();

  assert.equal(response.status, 502);
  assert.deepEqual(diagnostic, {
    upstreamStatus: 404,
    providerStatus: "NOT_FOUND",
    providerReason: "MODEL_NOT_AVAILABLE",
    safeMessage: "Gemini request failed (NOT_FOUND)",
  });
  assert.doesNotMatch(JSON.stringify(diagnostic), /secret-model-name|do-not-expose/);
  assert.doesNotMatch(body, /secret-model-name|do-not-expose/);
  assert.doesNotMatch(body, new RegExp(API_KEY));
});

test("Worker derives a safe provider status from an Interactions error code", async () => {
  let diagnostic;
  const app = createCompressionWorkerApp({
    onProviderDiagnostic: (value) => {
      diagnostic = value;
    },
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        code: "model_not_found",
        message: "raw interaction error detail",
      },
    }), { status: 404, headers: { "Content-Type": "application/json" } }),
  });

  const response = await app.request(
    "https://internal.test/v1/compress",
    requestBody({ text: "原文", profile: "semantic-dense-v1" }),
    { GEMINI_API_KEY: API_KEY },
  );

  assert.equal(response.status, 502);
  assert.deepEqual(diagnostic, {
    upstreamStatus: 404,
    providerStatus: "model_not_found",
    providerReason: null,
    safeMessage: "Gemini request failed (model_not_found)",
  });
  assert.doesNotMatch(await response.text(), /raw interaction error detail/);
});

test("Worker maps timeout and missing secret without leaking configuration", async () => {
  let aborted = false;
  const app = createCompressionWorkerApp({
    fetchImpl: async (_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      });
    }),
  });

  const timeoutResponse = await app.request(
    "https://internal.test/v1/compress",
    requestBody({ text: "原文", profile: "semantic-dense-v1" }),
    { GEMINI_API_KEY: API_KEY, GEMINI_TIMEOUT_MS: "5" },
  );
  assert.equal(timeoutResponse.status, 504);
  assert.equal((await timeoutResponse.json()).error, "provider_timeout");
  assert.equal(aborted, true);

  const missingSecretResponse = await app.request(
    "https://internal.test/v1/compress",
    requestBody({ text: "原文", profile: "semantic-dense-v1" }),
    {},
  );
  assert.equal(missingSecretResponse.status, 503);
  assert.equal((await missingSecretResponse.json()).error, "provider_unavailable");
});
