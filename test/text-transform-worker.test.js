import test from "node:test";
import assert from "node:assert/strict";
import app from "../src/text-transform-worker.js";

test("text transform health and capabilities are available", async () => {
  const health = await app.request("http://example.test/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    status: "ok",
    service: "text-transform",
    version: "v1",
    engineVersion: "0.2.0-phase2",
  });

  const capabilities = await app.request("http://example.test/v1/capabilities");
  const payload = await capabilities.json();
  assert.equal(capabilities.status, 200);
  assert.equal(payload.tokenizerEnabled, false);
  assert.ok(payload.profiles.includes("legacy-kanji"));
  assert.ok(payload.tokenizerProfiles.includes("okurigana-abbreviation"));
});

test("ruby parse and dictionary transform endpoints use the extracted core", async () => {
  const ruby = await app.request("http://example.test/v1/ruby/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "｜山田太郎《やまだたろう》" }),
  });
  assert.equal(ruby.status, 200);
  assert.equal((await ruby.json()).segments[0].base, "山田太郎");

  const transformed = await app.request("http://example.test/v1/transform", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "学校と国", profile: ["legacy-kanji"] }),
  });
  assert.equal(transformed.status, 200);
  assert.equal((await transformed.json()).text, "學校と國");
});

test("text transform endpoint rejects invalid and tokenizer-dependent requests", async () => {
  const invalidJson = await app.request("http://example.test/v1/transform", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not-json",
  });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).error, "invalid_json");

  const tokenizerRequest = await app.request("http://example.test/v1/transform", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "分かる", profile: ["okurigana-abbreviation"] }),
  });
  assert.equal(tokenizerRequest.status, 501);
  assert.equal((await tokenizerRequest.json()).error, "invalid_profile");
});
