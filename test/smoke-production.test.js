import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCapabilitiesPayload,
  validateClockPayload,
  validateMoonPayload,
  validateRokuyoPayload,
  validateWeatherPayload,
} from "../scripts/smoke-production.mjs";

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
