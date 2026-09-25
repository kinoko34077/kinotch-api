import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIT_PROFILES,
  AUDIT_SEMANTICS_VERSION,
  DEFAULT_JEV_MODEL,
  REMOTE_AUDIT_LIMITS,
  normalizeAuditFiles,
  validateAuditInput,
} from "../src/jev-audit/contract.js";

const repeatCodePoints = (value, count) => Array.from({ length: count }, () => value).join("");

test("remote contract pins v0.2.12 semantics and model", () => {
  assert.equal(AUDIT_SEMANTICS_VERSION, "0.2.12");
  assert.equal(DEFAULT_JEV_MODEL, "jev-1.13.0");
  assert.deepEqual(Object.keys(AUDIT_PROFILES).sort(), ["development", "generic"]);
  assert.equal(REMOTE_AUDIT_LIMITS.maxRequestBytes, 1024 * 1024);
  assert.equal(REMOTE_AUDIT_LIMITS.maxFiles, 100);
  assert.equal(REMOTE_AUDIT_LIMITS.maxPathCodePoints, 512);
  assert.equal(REMOTE_AUDIT_LIMITS.maxSuppliedCodePoints, 500_000);
  assert.equal(REMOTE_AUDIT_LIMITS.maxFileContentCodePoints, 12_000);
  assert.equal(REMOTE_AUDIT_LIMITS.batchChars, 32_000);
  assert.equal(REMOTE_AUDIT_LIMITS.maxBatches, 32);
  assert.equal(REMOTE_AUDIT_LIMITS.maxConcurrency, 4);
  assert.equal(REMOTE_AUDIT_LIMITS.providerTimeoutMs, 45_000);
});

test("bundled profiles preserve the local status criteria", () => {
  const expected = {
    clear: "このファイル群の内容から直接確認できる具体的な問題は見当たらない",
    review: "具体的な懸念または不整合の兆候があり、確認が望ましい",
    rework: "このファイル群の内容から、修正が必要な具体的問題が強く示される",
    unknown: "このファイル群だけでは局所的な問題の有無を判断できない",
  };
  assert.deepEqual(AUDIT_PROFILES.development.statusCriteria, expected);
  assert.deepEqual(AUDIT_PROFILES.generic.statusCriteria, expected);
  assert.equal(AUDIT_PROFILES.development.rules.length, 10);
  assert.equal(AUDIT_PROFILES.generic.rules.length, 5);
  assert.equal(AUDIT_PROFILES.development.rules[0].id, "DEV-REQ");
  assert.equal(AUDIT_PROFILES.generic.rules[0].id, "GEN-GOAL");
});

test("validateAuditInput accepts only explicit remote snapshots", () => {
  assert.deepEqual(
    validateAuditInput({ files: [{ path: "src/app.py", content: "print(1)" }] }),
    { ok: true, profile: "development" },
  );

  for (const body of [
    { path: "C:/repo", files: [{ path: "a", content: "x" }] },
    { files: [{ path: "a", content: "x" }], changed_only: true },
    { files: [{ path: "a", content: "x" }], profile: "custom.json" },
    { files: [] },
    { files: [{ path: "", content: "x" }] },
    { files: [{ path: "a", content: "" }] },
    { files: [{ path: "a", content: "x", change: 1 }] },
    { files: [{ path: "a", content: "x" }, { path: "a", content: "y" }] },
  ]) {
    assert.equal(validateAuditInput(body).ok, false, JSON.stringify(body));
  }
});

test("validateAuditInput enforces remote count and Unicode code-point limits", () => {
  const tooMany = Array.from({ length: 101 }, (_, index) => ({ path: `f${index}.txt`, content: "x" }));
  assert.equal(validateAuditInput({ files: tooMany }).ok, false);

  const longPath = repeatCodePoints("😀", 513);
  assert.equal(validateAuditInput({ files: [{ path: longPath, content: "x" }] }).ok, false);

  const tooLarge = repeatCodePoints("😀", 500_001);
  assert.equal(validateAuditInput({ files: [{ path: "large.txt", content: tooLarge }] }).ok, false);
});

test("normalizeAuditFiles truncates content by Unicode code points and reports paths", () => {
  const content = repeatCodePoints("😀", 12_100);
  const normalized = normalizeAuditFiles([{ path: "emoji.txt", content }]);

  assert.deepEqual(normalized.truncatedPaths, ["emoji.txt"]);
  assert.ok([...normalized.files[0].content].length <= 12_000);
  assert.match(normalized.files[0].content, /<truncated>/);
  assert.equal(normalized.files[0].truncated, true);
});
