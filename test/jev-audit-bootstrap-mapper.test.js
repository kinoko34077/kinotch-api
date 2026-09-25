import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";

import {
  MAPPER_MODES,
  mapProductionSecrets,
  requiredKeysForMode,
  runMappedCommand,
} from "../scripts/production-secret-mapper.mjs";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

function fakeSpawn(exitCode, capture) {
  return (command, args, options) => {
    capture.push({ command, args, options });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", exitCode, null));
    return child;
  };
}

test("Jev Audit bootstrap mapper exposes only the Cloudflare deployment credential", () => {
  assert.equal(MAPPER_MODES.JEV_AUDIT_BOOTSTRAP, "jev-audit-bootstrap");
  assert.deepEqual(requiredKeysForMode(MAPPER_MODES.JEV_AUDIT_BOOTSTRAP), ["CLOUDFLARE_API_TOKEN"]);
  assert.deepEqual(mapProductionSecrets({
    CLOUDFLARE_API_TOKEN: "cf-fixture",
    CF_ACCESS_CLIENT_SECRET: "must-not-reach-bootstrap",
    JEV_AUDIT_SMOKE_TOKEN: "must-not-reach-bootstrap",
  }, MAPPER_MODES.JEV_AUDIT_BOOTSTRAP), {
    CLOUDFLARE_API_TOKEN: "cf-fixture",
  });
});

test("Jev Audit bootstrap mapper launches only bootstrap authority", async () => {
  const calls = [];
  const exitCode = await runMappedCommand(MAPPER_MODES.JEV_AUDIT_BOOTSTRAP, {
    secrets: { CLOUDFLARE_API_TOKEN: "cf-fixture" },
    sourceEnv: {
      PATH: "fixture-path",
      CF_ACCESS_CLIENT_SECRET: "must-not-reach-bootstrap",
      JEV_AUDIT_SMOKE_TOKEN: "must-not-reach-bootstrap",
    },
    spawnImpl: fakeSpawn(0, calls),
  });
  assert.equal(exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.join(" ").includes("bootstrap:jev-audit"), true);
  assert.equal(calls[0].options.env.CLOUDFLARE_API_TOKEN, "cf-fixture");
  assert.equal(calls[0].options.env.CF_ACCESS_CLIENT_SECRET, undefined);
  assert.equal(calls[0].options.env.JEV_AUDIT_SMOKE_TOKEN, undefined);
});

test("package scripts expose raw and opaque Jev Audit bootstrap entry points", () => {
  assert.equal(packageJson.scripts["bootstrap:jev-audit"], "node scripts/jev-audit-bootstrap.mjs");
  assert.equal(
    packageJson.scripts["bootstrap:jev-audit:local"],
    "node scripts/production-secret-mapper.mjs jev-audit-bootstrap",
  );
});
