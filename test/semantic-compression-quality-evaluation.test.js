import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const corpus = JSON.parse(await readFile(
  new URL("./fixtures/semantic-compression-quality.json", import.meta.url),
  "utf8",
));

const requiredCategories = new Set([
  "short",
  "long",
  "bullets",
  "spec",
  "technical-report",
  "comparison",
  "condition",
  "exception",
  "negation",
  "uncertainty",
  "numbers",
  "url-sha-path",
  "chronology",
  "fact-speculation",
  "prompt-injection",
]);

test("quality corpus contains 50 synthetic cases with required coverage", () => {
  assert.equal(corpus.length, 50);

  const ids = corpus.map((entry) => entry.id);
  assert.equal(new Set(ids).size, corpus.length);

  const categories = new Set(corpus.map((entry) => entry.category));
  for (const category of requiredCategories) assert.ok(categories.has(category), category);

  for (const entry of corpus) {
    assert.match(entry.id, /^q\d{2}$/);
    assert.equal(typeof entry.category, "string");
    assert.equal(typeof entry.input, "string");
    assert.ok(entry.input.length > 0);
    assert.equal(typeof entry.markers, "object");
    for (const markers of Object.values(entry.markers)) {
      assert.ok(Array.isArray(markers));
      for (const marker of markers) assert.equal(typeof marker, "string");
    }
  }

  assert.ok(corpus.some((entry) => entry.markers.numbers?.length));
  assert.ok(corpus.some((entry) => entry.markers.dates?.length));
  assert.ok(corpus.some((entry) => entry.markers.urls?.length));
  assert.ok(corpus.some((entry) => entry.markers.sha?.length));
  assert.ok(corpus.some((entry) => entry.markers.paths?.length));
});

test("quality corpus uses synthetic public-safe URL, SHA, and path markers", () => {
  const serialized = JSON.stringify(corpus);
  assert.doesNotMatch(serialized, /GEMINI_API_KEY|COMPRESSION_API_TOKEN/);
  assert.doesNotMatch(serialized, /kinoko34077|kinotch-api/);
  assert.match(serialized, /https:\/\/example\.test/);
  assert.match(serialized, /0123456789abcdef0123456789abcdef01234567/);
  assert.match(serialized, /src\//);
});
