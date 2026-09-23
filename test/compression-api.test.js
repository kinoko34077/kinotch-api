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
    COMPRESSION_PREAUTH_RATE_LIMITER: allowRateLimiter(),
    COMPRESSION_RATE_LIMITER: allowRateLimiter(),
    COMPRESSION_TOKEN_RATE_LIMITER: allowRateLimiter(),
    COMPRESSION: {
      fetch() {
        return Promise.resolve(compressionResponse({ compressed_text: "題名\n- 結果" }));
      },
    },
    ...overrides,
  };
}

test("compression policy is isolated with a 2.5 MiB body limit and dedicated 5/60 limiter", () => {
  assert.equal(routePolicies.compression.id, "semantic-compression");
  assert.equal(routePolicies.compression.path, "/v1/compress");
  assert.equal(routePolicies.compression.method, "POST");
  assert.equal(routePolicies.compression.bodyLimitBytes, 2.5 * 1024 * 1024);
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

test("compression route applies the pre-auth IP limiter before reading or authenticating the body", async () => {
  let authenticatedLimiterCalls = 0;
  let upstreamCalls = 0;
  const response = await app.request(
    "http://example.test/v1/compress",
    requestInit({ text: "x".repeat(100), profile: "semantic-dense-v1" }, {
      Authorization: `Bearer ${TOKEN}`,
      "CF-Connecting-IP": "198.51.100.20",
      "X-Request-ID": "preauth-limit-test",
    }),
    env({
      COMPRESSION_PREAUTH_RATE_LIMITER: {
        limit(input) {
          assert.equal(input.key, "semantic-compression-preauth:198.51.100.20");
          return Promise.resolve({ success: false });
        },
      },
      COMPRESSION_RATE_LIMITER: { limit() { authenticatedLimiterCalls += 1; return Promise.resolve({ success: true }); } },
      COMPRESSION: { fetch() { upstreamCalls += 1; return Promise.resolve(compressionResponse({})); } },
    }),
  );

  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, "rate_limited");
  assert.equal(authenticatedLimiterCalls, 0);
  assert.equal(upstreamCalls, 0);
});

test("compression route limits successful credentials by a non-reversible token fingerprint", async () => {
  let authenticatedIpKey;
  let tokenKey;
  const response = await app.request(
    "http://example.test/v1/compress",
    requestInit({ text: "原文", profile: "semantic-dense-v1" }, { Authorization: `Bearer ${TOKEN}` }),
    env({
      COMPRESSION_RATE_LIMITER: {
        limit(input) {
          authenticatedIpKey = input.key;
          return Promise.resolve({ success: true });
        },
      },
      COMPRESSION_TOKEN_RATE_LIMITER: {
        limit(input) {
          tokenKey = input.key;
          return Promise.resolve({ success: true });
        },
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.match(authenticatedIpKey, /^semantic-compression:/);
  assert.match(tokenKey, /^semantic-compression-auth:[0-9a-f]{64}$/);
  assert.doesNotMatch(tokenKey, new RegExp(TOKEN));
});

test("compression rate limiting ignores caller-controlled X-Forwarded-For without Cloudflare client IP", async () => {
  let authenticatedIpKey;
  const response = await app.request(
    "http://example.test/v1/compress",
    requestInit(
      { text: "原文", profile: "semantic-dense-v1" },
      { Authorization: `Bearer ${TOKEN}`, "X-Forwarded-For": "203.0.113.9, 198.51.100.4" },
    ),
    env({
      COMPRESSION_RATE_LIMITER: {
        limit(input) {
          authenticatedIpKey = input.key;
          return Promise.resolve({ success: true });
        },
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(authenticatedIpKey, "semantic-compression:unknown");
});

test("compression route fails closed when the pre-auth limiter is unavailable", async () => {
  let upstreamCalls = 0;
  const response = await app.request(
    "http://example.test/v1/compress",
    requestInit({ text: "原文", profile: "semantic-dense-v1" }, { Authorization: `Bearer ${TOKEN}` }),
    env({
      COMPRESSION_PREAUTH_RATE_LIMITER: undefined,
      COMPRESSION: { fetch() { upstreamCalls += 1; return Promise.resolve(compressionResponse({})); } },
    }),
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "rate_limiter_unavailable");
  assert.equal(upstreamCalls, 0);
});

test("compression route fails closed when the token fingerprint limiter fails", async () => {
  let upstreamCalls = 0;
  const response = await app.request(
    "http://example.test/v1/compress",
    requestInit({ text: "原文", profile: "semantic-dense-v1" }, { Authorization: `Bearer ${TOKEN}` }),
    env({
      COMPRESSION_TOKEN_RATE_LIMITER: { limit() { return Promise.resolve({ success: false }); } },
      COMPRESSION: { fetch() { upstreamCalls += 1; return Promise.resolve(compressionResponse({})); } },
    }),
  );

  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, "rate_limited");
  assert.equal(upstreamCalls, 0);
});

test("compression route fails closed when the token fingerprint limiter is unavailable", async () => {
  let upstreamCalls = 0;
  const response = await app.request(
    "http://example.test/v1/compress",
    requestInit({ text: "原文", profile: "semantic-dense-v1" }, { Authorization: `Bearer ${TOKEN}` }),
    env({
      COMPRESSION_TOKEN_RATE_LIMITER: undefined,
      COMPRESSION: { fetch() { upstreamCalls += 1; return Promise.resolve(compressionResponse({})); } },
    }),
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "rate_limiter_unavailable");
  assert.equal(upstreamCalls, 0);
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
            model: "gemini-3.5-flash-lite",
            input_chars: 2,
            output_chars: 7,
            input_sha256: "a".repeat(64),
            output_sha256: "b".repeat(64),
            usage: {
              input_tokens: 100,
              output_tokens: 30,
              thought_tokens: 0,
              cached_tokens: 10,
              total_tokens: 130,
            },
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
    model: "gemini-3.5-flash-lite",
    input_chars: 2,
    output_chars: 7,
    input_sha256: "a".repeat(64),
    output_sha256: "b".repeat(64),
    usage: {
      input_tokens: 100,
      output_tokens: 30,
      thought_tokens: 0,
      cached_tokens: 10,
      total_tokens: 130,
    },
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

test("Gateway accepts compact-v1 and forwards only the public compression request", async () => {
  let forwarded;
  const response = await app.request(
    "http://example.test/v1/compress",
    requestInit(
      { text: "原文", profile: "compact-v1" },
      { Authorization: `Bearer ${TOKEN}` },
    ),
    env({
      COMPRESSION: {
        fetch(request) {
          forwarded = request;
          return Promise.resolve(compressionResponse({
            compressed_text: "短縮結果",
            profile: "compact-v1",
            prompt_version: "compact-v1",
            model: "gemini-3.5-flash-lite",
            input_chars: 2,
            output_chars: 4,
            input_sha256: "a".repeat(64),
            output_sha256: "b".repeat(64),
            usage: {
              input_tokens: 100,
              output_tokens: 30,
              thought_tokens: 0,
              cached_tokens: 10,
              total_tokens: 130,
            },
            warnings: [],
          }));
        },
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).profile, "compact-v1");
  assert.deepEqual(await forwarded.json(), { text: "原文", profile: "compact-v1" });
  assert.equal(forwarded.headers.get("Authorization"), null);
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
  assert.deepEqual(geminiRequest.body.generation_config, { thinking_level: "minimal" });
  assert.equal(geminiRequest.body.store, false);
  assert.equal(geminiRequest.body.temperature, undefined);
  assert.equal(geminiRequest.body.top_p, undefined);
  assert.equal(geminiRequest.body.top_k, undefined);
  assert.equal(geminiRequest.body.thinking_budget, undefined);
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
        "Content-Length": String(2.5 * 1024 * 1024 + 1),
      },
    },
    env(),
  );
  assert.equal(bodyLimitResponse.status, 413);
  assert.equal((await bodyLimitResponse.json()).error, "payload_too_large");
  assert.equal(upstreamCalls, 0);
});

test("compression body limit admits 200,000-code-point JSON and rejects the next wire byte", async () => {
  const controlBody = JSON.stringify({ text: "\u0000".repeat(200_000), profile: "semantic-dense-v1" });
  const astralBody = JSON.stringify({ text: "😀".repeat(200_000), profile: "semantic-dense-v1" });
  const escapedAstralBody = `{"text":"${"\\ud83d\\ude00".repeat(200_000)}","profile":"semantic-dense-v1"}`;

  assert.equal(routePolicies.compression.bodyLimitBytes, 2.5 * 1024 * 1024);
  assert.ok(Buffer.byteLength(controlBody, "utf8") < routePolicies.compression.bodyLimitBytes);
  assert.ok(Buffer.byteLength(astralBody, "utf8") < routePolicies.compression.bodyLimitBytes);
  assert.equal(Array.from(JSON.parse(escapedAstralBody).text).length, 200_000);
  assert.ok(Buffer.byteLength(escapedAstralBody, "utf8") < routePolicies.compression.bodyLimitBytes);

  const escapedResponse = await app.request(
    "http://example.test/v1/compress",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: escapedAstralBody,
    },
    env(),
  );
  assert.equal(escapedResponse.status, 200);

  const response = await app.request(
    "http://example.test/v1/compress",
    {
      ...requestInit({ text: "原文", profile: "semantic-dense-v1" }, { Authorization: `Bearer ${TOKEN}` }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
        "Content-Length": String(2.5 * 1024 * 1024 + 1),
      },
    },
    env(),
  );

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, "payload_too_large");
});

test("compression route rejects provider-context-unsafe text before binding", async () => {
  let upstreamCalls = 0;
  const response = await app.request(
    "http://example.test/v1/compress",
    requestInit({ text: "x".repeat(200_001), profile: "semantic-dense-v1" }, { Authorization: `Bearer ${TOKEN}` }),
    env({
      COMPRESSION: { fetch() { upstreamCalls += 1; return Promise.resolve(compressionResponse({})); } },
    }),
  );

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, "provider_context_limit");
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
