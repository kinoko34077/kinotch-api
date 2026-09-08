import test from "node:test";
import assert from "node:assert/strict";
import app from "../src/index.js";

function service(body, status = 200) {
  return {
    fetch() {
      return Promise.resolve(new Response(body, {
        status,
        headers: { "Content-Type": "application/json" },
      }));
    },
  };
}

function env(overrides = {}) {
  return {
    CLOCK_SERVER: service(JSON.stringify({ serverTime: 123 })),
    WEATHER_PROXY: service(JSON.stringify({ temp: 20, weather: "Clear" })),
    ROKUYO_PROXY: service(JSON.stringify([{ rokuyo: "友引" }])),
    TEXT_TRANSFORM: service(JSON.stringify({ text: "學校", engineVersion: "0.2.0-phase2" })),
    ...overrides,
  };
}

test("health route exposes service metadata", async () => {
  const response = await app.request("http://example.test/health", {}, env());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "kinotch-api",
    version: "v1",
  });
});

test("CORS preflight allows browser POST text API calls", async () => {
  const response = await app.request("http://example.test/v1/transform", {
    method: "OPTIONS",
    headers: {
      Origin: "https://reader.example.test",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  }, env());

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.match(response.headers.get("Access-Control-Allow-Methods") ?? "", /POST/);
});

test("proxy routes preserve upstream payloads", async () => {
  const cases = [
    ["/v1/time", { serverTime: 123 }],
    ["/v1/weather?lat=35.6&lon=139.7", { temp: 20, weather: "Clear" }],
    ["/v1/calendar/rokuyo?date=2026-09-07", [{ rokuyo: "友引" }]],
    ["/v1/astronomy/moon?lat=35.6&lon=139.7", [{ rokuyo: "友引" }]],
  ];

  for (const [path, expected] of cases) {
    const response = await app.request(`http://example.test${path}`, {}, env());
    assert.equal(response.status, 200, path);
    assert.deepEqual(await response.json(), expected, path);
  }
});

test("required query parameters return 400", async () => {
  for (const path of ["/v1/weather", "/v1/astronomy/moon"]) {
    const response = await app.request(`http://example.test${path}`, {}, env());
    assert.equal(response.status, 400, path);
  }

  const response = await app.request("http://example.test/v1/calendar/rokuyo", {}, env());
  assert.equal(response.status, 400);
});

test("unknown routes return JSON 404", async () => {
  const response = await app.request("http://example.test/nope", {}, env());
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not found" });
});

test("text API routes proxy through the text transform binding", async () => {
  const requests = [];
  const response = await app.request("http://example.test/v1/transform", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "学校", profile: ["legacy-kanji"] }),
  }, env({
    TEXT_TRANSFORM: {
      fetch(request) {
        requests.push({ method: request.method, body: request.body });
        return Promise.resolve(new Response(JSON.stringify({ text: "學校" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      },
    },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: "學校" });
  assert.equal(requests[0].method, "POST");
});

test("text API batch route proxies the complete request body", async () => {
  let receivedBody;
  const response = await app.request("http://example.test/v1/transform/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: ["学校", "国"], profile: ["legacy-kanji"] }),
  }, env({
    TEXT_TRANSFORM: {
      fetch(request) {
        receivedBody = request.body;
        return Promise.resolve(new Response(JSON.stringify({ texts: ["學校", "國"] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      },
    },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { texts: ["學校", "國"] });
  assert.deepEqual(JSON.parse(await new Response(receivedBody).text()), {
    texts: ["学校", "国"],
    profile: ["legacy-kanji"],
  });
});

test("gateway validates coordinate and calendar query domains", async () => {
  for (const path of [
    "/v1/weather?lat=91&lon=139.7",
    "/v1/astronomy/moon?lat=35.6&lon=181",
    "/v1/calendar/rokuyo?date=2026-02-30",
  ]) {
    const response = await app.request(`http://example.test${path}`, {}, env());
    assert.equal(response.status, 400, path);
    assert.equal((await response.json()).error, "invalid_query", path);
  }
});

test("gateway rejects oversized text bodies before the upstream service", async () => {
  let upstreamCalls = 0;
  const body = JSON.stringify({ text: "x".repeat(600_000) });
  const response = await app.request("http://example.test/v1/transform", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(new TextEncoder().encode(body).byteLength),
    },
    body,
  }, env({
    TEXT_TRANSFORM: {
      fetch() {
        upstreamCalls += 1;
        return Promise.resolve(new Response(JSON.stringify({ text: "unexpected" }), { status: 200 }));
      },
    },
  }));

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, "payload_too_large");
  assert.equal(upstreamCalls, 0);
});

test("gateway enforces route rate limits and returns Retry-After", async () => {
  let upstreamCalls = 0;
  const response = await app.request("http://example.test/v1/time", {}, env({
    GENERAL_RATE_LIMITER: {
      limit() {
        return Promise.resolve({ success: false });
      },
    },
    CLOCK_SERVER: {
      fetch() {
        upstreamCalls += 1;
        return Promise.resolve(new Response(JSON.stringify({ serverTime: 123 }), { status: 200 }));
      },
    },
  }));

  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, "rate_limited");
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.equal(response.headers.get("RateLimit-Limit"), "60");
  assert.equal(upstreamCalls, 0);
});

test("gateway propagates a safe request ID and only approved response headers", async () => {
  let upstreamRequestId;
  const response = await app.request("http://example.test/v1/time", {
    headers: { "X-Request-ID": "client-trace-123" },
  }, env({
    CLOCK_SERVER: {
      fetch(request) {
        upstreamRequestId = request.headers.get("X-Request-ID");
        return Promise.resolve(new Response(JSON.stringify({ serverTime: 123 }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "X-Upstream-Internal": "do-not-forward",
          },
        }));
      },
    },
  }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Request-ID"), "client-trace-123");
  assert.equal(upstreamRequestId, "client-trace-123");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Upstream-Internal"), null);
});

test("gateway returns 405 for a registered route with the wrong method", async () => {
  const response = await app.request("http://example.test/v1/time", { method: "POST" }, env());
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET");
  assert.equal((await response.json()).error, "method_not_allowed");
});

test("gateway classifies a missing upstream binding as 503", async () => {
  const response = await app.request("http://example.test/v1/time", {}, env({ CLOCK_SERVER: undefined }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "upstream_unavailable");
  assert.match(response.headers.get("X-Request-ID") ?? "", /^[A-Za-z0-9-]+$/);
});

test("gateway maps an upstream 500 response to 502", async () => {
  const response = await app.request("http://example.test/v1/time", {}, env({
    CLOCK_SERVER: service(JSON.stringify({ error: "worker_error" }), 500),
  }));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "worker_error" });
});

test("gateway maps an upstream timeout to 504", async () => {
  const response = await app.request("http://example.test/v1/time", {}, env({
    UPSTREAM_TIMEOUT_MS: 5,
    CLOCK_SERVER: {
      fetch(request) {
        return new Promise((resolve, reject) => {
          request.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      },
    },
  }));
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error, "upstream_timeout");
});
