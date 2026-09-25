import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mapperSource = await readFile(
  new URL("../scripts/production-secret-mapper.mjs", import.meta.url),
  "utf8",
);

test("Windows production secret mapper does not spawn npm.cmd directly", () => {
  assert.doesNotMatch(
    mapperSource,
    /return process\.platform === "win32" \? "npm\.cmd" : "npm"/,
  );
  assert.match(mapperSource, /ComSpec|COMSPEC|cmd\.exe/);
});
