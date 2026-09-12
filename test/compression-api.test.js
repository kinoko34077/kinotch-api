import test from "node:test";
import assert from "node:assert/strict";
import app from "../src/index.js";
import { routePolicies } from "../src/policies/routes.js";
import { createCompressionWorkerApp } from "../src/semantic-compression-worker.js";

const TOKEN = "<fixture-caller-token>";

function requestInit(body, headers = {}) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

function allowRateLimiter() {
  return {
    limit() {
      return Promise.resolve({ success: true });
    },
  };
}

function compressionResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function env(overrides = {}) {
  return {
    COMPRESSION_API_TOKEN: TOKEN,
    COMPRESSION_RATE_LIMITER: allowRateLimiter(),
    COMPRESSION: {
      fetch() {
        return Promise.resolve(compressionResponse({ compressed_text: "題名\n- 結果" }));
      },
    },
    ...overrides,
  };
}

test("compression policy is isolated with an 8 MiB body limit and dedicated 5/60 limiter", () => {
  assert.equal(routePolicies.compression.id, "semantic-compression");
  assert.equal(routePolicies.compression.path, "/v1/compress");
  assert.equal(routePolicies.compression.method, "POST");
  assert.equal(routePolicies.compression.bodyLimitBytes, 8 * 1024 * 1024);
  assert.deepEqual(routePolicies.compression.rateLimit, {
    binding: "COMPRESSION_RATE_LIMITER",
    limit: 5,
    period: 60,
  });
  assert.equal(routePolicies.compression.upstreamTimeoutMs, 50_000);
  assert.notEqual(routePolicies.compression.rateLimit, routePolicies.transform.rateLimit);
});

test("compression route rejects missing and invalid caller credentials", async () => {
  const missing = await app.request(
    "http://example.test/v1/compress",
    requestInit({ text: "原文", profile: "semantic-dense-v1" }),
    env(),
  );
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).error, "authentication_failed");

  const wrong = await app.request(
    "http://example.test/v1/compress",
    requestInit({ text: "原文", profile: "semantic-dense-v1" }, { Authorization: "Bearer <wrong-fixture-token>" }),
    env(),
  );
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error, "authentication_failed");
});

test("compression route fails closed when caller secret is absent", async () => {
  const response = await app.request(
    "http://example.test/v1/compress",
    requestInit({ text: "原文", profile: "semantic-dense-v1" }, { Authorization: `Bearer ${TOKEN}` }),
    env({ COMPRESSION_API_TOKEN: undefined }),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "authentication_unavailable");
});

test("authenticated compression requests use only the Compression binding and fixed body", async () => {
  let upstreamRequest;
  let compressionRateLimitCalls = 0;
  let textRateLimitCalls = 0;
  const response = await app.request(
    "http://example.test/v1/compress",
    requestInit(
      { text: "原文", profile: "semantic-dense-v1" },
      { Authorization: `Bearer ${TOKEN}`, "X-Request-ID": "compression-test" },
    ),
    env({
      COMPRESSION_RATE_LIMITER: {
        limit(input) {
          compressionRateLimitCalls += 1;
          assert.match(input.key, /^semantic-compression:/);
          return Promise.resolve({ success: true });
        },
      },
      TEXT_RATE_LIMITER: {
        limit() {
          textRateLimitCalls += 1;
          return Promise.resolve({ success: true });
        },
      },
      COMPRESSION: {
        fetch(request) {
          upstreamRequest = request;
          return Promise.resolve(compressionResponse({
            compressed_text: "題名\n- 結果",
            profile: "semantic-dense-v1",
            prompt_version: "semantic-dense-v1",
            model: "gemini-2.5-flash-lite",
            input_chars: 2,
            output_chars: 7,
            input_sha256: "a".repeat(64),
            output_sha256: "b".repeat(64),
            warnings: [],
          }));
        },
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    compressed_text: "題名\n- 結果",
    profile: "semantic-dense-v1",
    prompt_version: "semantic-dense-v1",
    model: "gemini-2.5-flash-lite",
    input_chars: 2,
    output_chars: 7,
    input_sha256: "a".repeat(64),
    output_sha256: "b".repeat(64),
    warnings: [],
  });
  assert.equal(upstreamRequest.method, "POST");
  assert.equal(upstreamRequest.headers.get("X-Request-ID"), "compression-test");
  assert.equal(upstreamRequest.headers.get("Authorization"), null);
  assert.deepEqual(await upstreamRequest.json(), {
    text: "原文",
    profile: "semantic-dense-v1",
  });
  assert.equal(compressionRateLimitCalls, 1);
  assert.equal(textRateLimitCalls, 0);
});

test("Gateway to Service Binding to Worker reaches the fake Gemini boundary", async () => {
  let geminiRequest;
  const workerApp = createCompressionWorkerApp({
    fetchImpl: async (input, init) => {
      geminiRequest = { input, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        status: "completed",
        steps: [{ type: "model_output", content: [{ type: "text", text: "要点\n- 結果" }] }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const response = await app.request(
    "http://example.test/v1/compress",
    requestInit(
      { text: "原文", profile: "semantic-dense-v1" },
      { Authorization: `Bearer ${TOKEN}`, "X-Request-ID": "e2e-compression" },
    ),
    env({
      COMPRESSION: {
        fetch(request) {
          return workerApp.fetch(request, { GEMINI_API_KEY: "<fixture-gemini-key>" });
        },
      },
    }),
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.compressed_text, "要点\n- 結果");
  assert.equal(payload.input_chars, 2);
  assert.equal(payload.output_chars, 7);
  assert.equal(response.headers.get("X-Request-ID"), "e2e-compression");
  assert.equal(geminiRequest.body.input, "原文");
  assert.equal(geminiRequest.body.store, false);
  assert.equal(new Headers(geminiRequest.init.headers).get("x-goog-api-key"), "<fixture-gemini-key>");
});

test("compression route rejects caller prompt/model fields and invalid profiles", async () => {
  for (const body of [
    { text: "原文", profile: "semantic-dense-v1", prompt: "override" },
    { text: "原文", profile: "semantic-dense-v1", model: "other-model" },
    { text: "原文", profile: "other" },
    { text: "", profile: "semantic-dense-v1" },
    { text: 123, profile: "semantic-dense-v1" },
  ]) {
    const response = await app.request(
      "http://example.test/v1/compress",
      requestInit(body, { Authorization: `Bearer ${TOKEN}` }),
      env(),
    );
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.ok(["invalid_body", "invalid_profile", "empty_text"].includes((await response.json()).error));
  }
});

test("compression route enforces the Unicode text limit and byte body limit before binding", async () => {
  let upstreamCalls = 0;
  const oversizedText = `${"😀".repeat(1_000_001)}`;
  const oversizedTextResponse = await app.request(
    "http://example.test/v1/compress",
    requestInit({ text: oversizedText, profile: "semantic-dense-v1" }, { Authorization: `Bearer ${TOKEN}` }),
    env({
      COMPRESSION: { fetch() { upstreamCalls += 1; return Promise.resolve(compressionResponse({})); } },
    }),
  );
  assert.equal(oversizedTextResponse.status, 413);
  assert.equal((await oversizedTextResponse.json()).error, "payload_too_large");

  const bodyLimitResponse = await app.request(
    "http://example.test/v1/compress",
    {
      ...requestInit({ text: "原文", profile: "semantic-dense-v1" }, { Authorization: `Bearer ${TOKEN}` }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
        "Content-Length": String(8 * 1024 * 1024 + 1),
      },
    },
    env(),
  );
  assert.equal(bodyLimitResponse.status, 413);
  assert.equal((await bodyLimitResponse.json()).error, "payload_too_large");
  assert.equal(upstreamCalls, 0);
});

test("compression route uses its own rate limiter and does not call the binding when blocked", async () => {
  let upstreamCalls = 0;
  const response = await app.request(
    "http://example.test/v1/compress",
    requestInit({ text: "原文", profile: "semantic-dense-v1" }, { Authorization: `Bearer ${TOKEN}` }),
    env({
      COMPRESSION_RATE_LIMITER: { limit() { return Promise.resolve({ success: false }); } },
      COMPRESSION: { fetch() { upstreamCalls += 1; return Promise.resolve(compressionResponse({})); } },
    }),
  );
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, "rate_limited");
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.equal(response.headers.get("RateLimit-Limit"), "5");
  assert.equal(upstreamCalls, 0);
});

test("compression route normalizes unavailable binding and preserves safe provider status", async () => {
  const unavailable = await app.request(
    "http://example.test/v1/compress",
    requestInit({ text: "原文", profile: "semantic-dense-v1" }, { Authorization: `Bearer ${TOKEN}` }),
    env({ COMPRESSION: undefined }),
  );
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error, "upstream_unavailable");

  const quota = await app.request(
    "http://example.test/v1/compress",
    requestInit({ text: "原文", profile: "semantic-dense-v1" }, { Authorization: `Bearer ${TOKEN}` }),
    env({
      COMPRESSION: {
        fetch() {
          return Promise.resolve(compressionResponse(
            { error: "provider_rate_limited" },
            429,
            { "Retry-After": "7" },
          ));
        },
      },
    }),
  );
  assert.equal(quota.status, 429);
  assert.equal((await quota.json()).error, "provider_rate_limited");
  assert.equal(quota.headers.get("Retry-After"), "7");
});

test("compression CORS preflight allows Authorization without changing existing POST policy", async () => {
  const response = await app.request("http://example.test/v1/compress", {
    method: "OPTIONS",
    headers: {
      Origin: "https://reader.example.test",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type, x-request-id",
    },
  }, env());

  assert.equal(response.status, 204);
  assert.match(response.headers.get("Access-Control-Allow-Headers") ?? "", /authorization/i);
  assert.match(response.headers.get("Access-Control-Allow-Headers") ?? "", /content-type/i);
});
