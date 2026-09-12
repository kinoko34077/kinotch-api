import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCapabilitiesPayload,
  validateClockPayload,
  validateCompressionPayload,
  validateMoonPayload,
  validateRokuyoPayload,
  validateWeatherPayload,
  runCompressionSmoke,
} from "../scripts/smoke-production.mjs";
import { buildCompressionResponse } from "../src/semantic-compression/contract.js";

function capabilities(sourceRevision) {
  return {
    sourceRevision,
    ruleSetHash: "a".repeat(64),
    snapshotHash: "b".repeat(64),
    dictionaryHash: "c".repeat(64),
    engineVersion: "0.2.0-phase2",
    metadataVersion: "snapshot-v1",
    ruleSetVersion: "rules-v1",
    dictionaryVersion: "dictionary-v1",
  };
}

test("capabilities smoke accepts the expected source revision", () => {
  assert.equal(validateCapabilitiesPayload(capabilities("a".repeat(40)), "a".repeat(40)), null);
});

test("capabilities smoke rejects a source revision mismatch", () => {
  const error = validateCapabilitiesPayload(capabilities("b".repeat(40)), "a".repeat(40));
  assert.match(error ?? "", /sourceRevision/i);
});

test("local smoke still accepts unknown source revision without an expectation", () => {
  assert.equal(validateCapabilitiesPayload(capabilities("unknown")), null);
});

test("production smoke validators cover all standby service payloads", () => {
  assert.equal(validateClockPayload({ serverTime: 1_725_800_000_000 }), null);
  assert.equal(validateWeatherPayload({ temp: 24.5, weather: "Clear" }), null);
  assert.equal(validateRokuyoPayload([{ rokuyo: "友引" }]), null);
  assert.equal(validateMoonPayload({ result: [{ age: 14.2 }] }), null);
  assert.notEqual(validateClockPayload({ serverTime: "invalid" }), null);
  assert.notEqual(validateWeatherPayload({ temp: null, weather: "" }), null);
  assert.notEqual(validateRokuyoPayload([]), null);
  assert.notEqual(validateMoonPayload({ result: [] }), null);
});

test("compression smoke validator checks fixed provenance and exact text hashes", async () => {
  const inputText = "A😀";
  const payload = {
    compressed_text: "題名\n- 内容",
    profile: "semantic-dense-v1",
    prompt_version: "semantic-dense-v1",
    model: "gemini-2.5-flash-lite",
    input_chars: 2,
    output_chars: 7,
    input_sha256: "".padStart(64, "0"),
    output_sha256: "".padStart(64, "0"),
    warnings: [],
  };

  const invalid = await validateCompressionPayload(payload, inputText);
  assert.match(invalid ?? "", /input_sha256/i);
});

test("compression smoke calls the Gateway with a caller token and returns safe provenance", async () => {
  const inputText = "事実: 観測値は10。推測: 原因はZの可能性がある。条件: AならB。";
  let received;
  const compressedPayload = await buildCompressionResponse({
    compressedText: "要点",
    inputText,
    warnings: [],
  });
  const result = await runCompressionSmoke({
    token: "smoke-token",
    path: "/v1/compress",
    fetchImpl: async (input, init) => {
      received = { input, init };
      return new Response(JSON.stringify(compressedPayload), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Request-ID": "smoke-compression" },
      });
    },
  });

  assert.match(received.input, /\/v1\/compress$/);
  assert.equal(new Headers(received.init.headers).get("Authorization"), "Bearer smoke-token");
  assert.equal(JSON.parse(received.init.body).profile, "semantic-dense-v1");
  assert.equal(result.status, 200);
  assert.equal(result.model, "gemini-2.5-flash-lite");
  assert.equal(result.promptVersion, "semantic-dense-v1");
  assert.equal(result.requestId, "smoke-compression");
});

test("compression smoke refuses to run without an explicit caller token", async () => {
  await assert.rejects(
    () => runCompressionSmoke({ fetchImpl: async () => { throw new Error("network must not be called"); } }),
    /COMPRESSION_SMOKE_TOKEN/,
  );
});

test("compression smoke validator rejects changed model, prompt, counts, hashes, and warnings", async () => {
  const base = {
    compressed_text: "題名\n- 内容",
    profile: "semantic-dense-v1",
    prompt_version: "semantic-dense-v1",
    model: "gemini-2.5-flash-lite",
    input_chars: 2,
    output_chars: 7,
    input_sha256: "a".repeat(64),
    output_sha256: "b".repeat(64),
    warnings: [],
  };
  const cases = [
    [{ ...base, model: "other" }, /model/i],
    [{ ...base, prompt_version: "other" }, /prompt/i],
    [{ ...base, input_chars: 99 }, /input_chars/i],
    [{ ...base, output_chars: 99 }, /output_chars/i],
    [{ ...base, input_sha256: "A".repeat(64) }, /input_sha256/i],
    [{ ...base, output_sha256: "not-a-hash" }, /output_sha256/i],
    [{ ...base, warnings: "warning" }, /warnings/i],
  ];
  for (const [payload, pattern] of cases) {
    const error = await validateCompressionPayload(payload, "入力");
    assert.match(error ?? "", pattern);
  }
});
