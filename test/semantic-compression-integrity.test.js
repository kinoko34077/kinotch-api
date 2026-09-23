import test from "node:test";
import assert from "node:assert/strict";
import { inspectCompressionIntegrity, COMPRESSION_WARNING_CODES } from "../src/semantic-compression/integrity.js";

test("integrity warnings detect missing machine-readable markers without exposing values", () => {
  const input = "値42、割合37.5%、日付2026-09-13、URL https://example.test/a、SHA 0123456789abcdef0123456789abcdef01234567、path ./src/app.js、request_id=req-123、禁止: keyを含めない。";
  const result = inspectCompressionIntegrity(input, "要点のみ");

  assert.deepEqual(result.warnings, [
    COMPRESSION_WARNING_CODES.MISSING_NUMERIC_MARKER,
    COMPRESSION_WARNING_CODES.MISSING_PERCENTAGE_MARKER,
    COMPRESSION_WARNING_CODES.MISSING_DATE_MARKER,
    COMPRESSION_WARNING_CODES.MISSING_URL,
    COMPRESSION_WARNING_CODES.MISSING_COMMIT_SHA,
    COMPRESSION_WARNING_CODES.MISSING_FILE_PATH,
    COMPRESSION_WARNING_CODES.MISSING_ID,
    COMPRESSION_WARNING_CODES.POSSIBLE_NEGATION_LOSS,
  ]);
  for (const warning of result.warnings) {
    assert.doesNotMatch(warning, /42|37\.5|example|012345|req-123|app\.js|key/);
  }
});

test("integrity warnings are empty when markers and negation remain", () => {
  const input = "値42、割合37.5%、日付2026-09-13、URL https://example.test/a、SHA 0123456789abcdef0123456789abcdef01234567、path ./src/app.js、request_id=req-123、禁止: keyを含めない。";
  const output = "値42; 37.5%; 2026-09-13; https://example.test/a; 0123456789abcdef0123456789abcdef01234567; ./src/app.js; request_id=req-123; 禁止: keyを含めない。";
  assert.deepEqual(inspectCompressionIntegrity(input, output).warnings, []);
});

test("integrity inspection does not treat empty input as a marker failure", () => {
  assert.deepEqual(inspectCompressionIntegrity("", "").warnings, []);
});
