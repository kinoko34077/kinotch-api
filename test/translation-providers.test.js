import test from "node:test";
import assert from "node:assert/strict";
import { azureProvider, googleProvider } from "../src/translation/providers.js";

test("Azure adapter sends target language and subscription header", async () => {
  let seen;
  const provider = azureProvider({ key: "fake", region: "test", fetchImpl: async (url, options) => {
    seen = { url: String(url), options };
    return { ok: true, json: async () => [{ translations: [{ text: "こんにちは" }] }] };
  } });
  assert.equal(await provider.translate({ text: "hello", source_language: "en", target_language: "ja" }), "こんにちは");
  assert.match(seen.url, /to=ja/);
  assert.equal(seen.options.headers["Ocp-Apim-Subscription-Key"], "fake");
});

test("Google adapter sends text and target language", async () => {
  let seen;
  const provider = googleProvider({ key: "fake", fetchImpl: async (_url, options) => {
    seen = JSON.parse(options.body);
    return { ok: true, json: async () => ({ data: { translations: [{ translatedText: "こんにちは" }] } }) };
  } });
  assert.equal(await provider.translate({ text: "hello", source_language: "en", target_language: "ja" }), "こんにちは");
  assert.equal(seen.target, "ja");
  assert.equal(seen.q, "hello");
});
