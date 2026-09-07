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
