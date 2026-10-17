import test from "node:test";
import assert from "node:assert/strict";
import { translate, validateTranslationRequest } from "../src/translation/core.js";

test("rejects invalid input", () => {
  assert.throws(() => validateTranslationRequest({ text: "" }), /invalid_text/);
  assert.throws(() => validateTranslationRequest({ text: "hi", target_language: "fr" }), /invalid_target_language/);
});

test("defaults to zero external calls", async () => {
  const result = await translate({ text: "Hello" }, {
    providers: [{ id: "azure", translate: () => { throw new Error("unexpected"); } }],
  });
  assert.equal(result.status, "original");
});

test("falls back from Azure to Google", async () => {
  const calls = [];
  const result = await translate({ text: "Hello" }, {
    providers: [
      { id: "azure", translate: () => { calls.push("azure"); throw new Error("offline"); } },
      { id: "google", translate: () => { calls.push("google"); return "こんにちは"; } },
    ],
    admit: () => true,
  });
  assert.deepEqual(calls, ["azure", "google"]);
  assert.equal(result.translated, "こんにちは");
  assert.equal(result.provider, "google");
});

test("preserves original if both providers fail", async () => {
  const result = await translate({ text: "Hello" }, {
    providers: [{ id: "azure", translate: () => { throw new Error("offline"); } }],
    admit: () => true,
  });
  assert.equal(result.original, "Hello");
  assert.equal(result.translated, null);
});
