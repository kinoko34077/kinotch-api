import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("existing Gateway binds only approved private Identity pilot service", async () => {
  const wrangler = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(wrangler.name, "api");
  assert.equal(wrangler.workers_dev, true); // Existing public API stays the sole ingress.
  assert.equal(wrangler.preview_urls, false);
  assert.deepEqual(wrangler.services, [
    { binding: "CLOCK_SERVER", service: "clock-server" },
    { binding: "WEATHER_PROXY", service: "weather-proxy" },
    { binding: "ROKUYO_PROXY", service: "rokuyo-proxy" },
    { binding: "TEXT_TRANSFORM", service: "text-transform" },
    { binding: "COMPRESSION", service: "semantic-compression" },
    { binding: "JEV_AUDIT", service: "jev-audit" },
    { binding: "IDENTITY_PILOT", service: "kinotch-identity-pilot" },
  ]);
  assert.ok(!Object.hasOwn(wrangler, "d1_databases"));
  assert.ok(!Object.hasOwn(wrangler, "unsafe"));
});
