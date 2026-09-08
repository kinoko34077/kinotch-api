import test from "node:test";
import assert from "node:assert/strict";
import { validateCapabilitiesPayload } from "../scripts/smoke-production.mjs";

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
