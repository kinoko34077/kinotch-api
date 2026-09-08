import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import app from "../src/text-transform-worker.js";

const dictionaryDirectory = path.resolve("src/text-core/dict");
const assets = {
  async fetch(request) {
    const fileName = path.basename(new URL(request.url).pathname);
    const bytes = await readFile(path.join(dictionaryDirectory, fileName));
    return new Response(bytes, { status: 200 });
  },
};

const source = "分かることが奇跡だった。".repeat(1_000);
const request = () => app.request("http://example.test/v1/transform", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: source, profile: ["okurigana-abbreviation"] }),
}, { ASSETS: assets });

const coldStart = performance.now();
const coldResponse = await request();
const coldPayload = await coldResponse.json();
const coldMs = performance.now() - coldStart;

const warmTimes = [];
for (let index = 0; index < 5; index += 1) {
  const startedAt = performance.now();
  const response = await request();
  const payload = await response.json();
  if (response.status !== 200 || typeof payload.text !== "string" || !payload.text.includes("分る")) {
    throw new Error("benchmark response validation failed");
  }
  warmTimes.push(performance.now() - startedAt);
}

const averageWarmMs = warmTimes.reduce((sum, value) => sum + value, 0) / warmTimes.length;

const batchTexts = Array.from({ length: 256 }, (_, index) => `${index}: 分かることが奇跡だった。`);
const batchStartedAt = performance.now();
const batchResponse = await app.request("http://example.test/v1/transform/batch", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ texts: batchTexts, profile: ["okurigana-abbreviation"] }),
}, { ASSETS: assets });
const batchPayload = await batchResponse.json();
const batchMs = performance.now() - batchStartedAt;
if (batchResponse.status !== 200 || !Array.isArray(batchPayload.texts) || batchPayload.texts.length !== batchTexts.length) {
  throw new Error("batch benchmark response validation failed");
}

console.log(JSON.stringify({
  characters: source.length,
  coldStatus: coldResponse.status,
  coldOutputSample: coldPayload.text.slice(0, 24),
  coldMs: Number(coldMs.toFixed(2)),
  warmMs: warmTimes.map((value) => Number(value.toFixed(2))),
  averageWarmMs: Number(averageWarmMs.toFixed(2)),
  batchItems: batchTexts.length,
  batchMs: Number(batchMs.toFixed(2)),
}, null, 2));
