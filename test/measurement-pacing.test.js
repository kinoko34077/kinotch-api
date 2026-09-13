import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MEASUREMENT_INTERVAL_MS,
  getSafeRetryAfterSeconds,
  resolveMeasurementIntervalMs,
} from "../scripts/measurement-pacing.mjs";

test("measurement scripts use a conservative default request interval", () => {
  assert.equal(resolveMeasurementIntervalMs({}, "COMPRESSION_QUALITY_INTERVAL_MS"), DEFAULT_MEASUREMENT_INTERVAL_MS);
  assert.equal(DEFAULT_MEASUREMENT_INTERVAL_MS, 15_000);
});

test("measurement interval can be tuned without allowing sub-second bursts", () => {
  assert.equal(resolveMeasurementIntervalMs({ COMPRESSION_QUALITY_INTERVAL_MS: "20000" }, "COMPRESSION_QUALITY_INTERVAL_MS"), 20_000);
  assert.throws(
    () => resolveMeasurementIntervalMs({ COMPRESSION_QUALITY_INTERVAL_MS: "999" }, "COMPRESSION_QUALITY_INTERVAL_MS"),
    /at least 1000 milliseconds/,
  );
  assert.throws(
    () => resolveMeasurementIntervalMs({ COMPRESSION_QUALITY_INTERVAL_MS: "fast" }, "COMPRESSION_QUALITY_INTERVAL_MS"),
    /must be an integer/,
  );
});

test("Retry-After extraction exposes only a bounded numeric value", () => {
  assert.equal(getSafeRetryAfterSeconds(new Response(null, { headers: { "Retry-After": "12" } })), 12);
  assert.equal(getSafeRetryAfterSeconds(new Response(null, { headers: { "Retry-After": "12.5" } })), null);
  assert.equal(getSafeRetryAfterSeconds(new Response(null)), null);
});
