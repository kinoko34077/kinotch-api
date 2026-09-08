import test from "node:test";
import assert from "node:assert/strict";
import { assertPrivateTextWorkerConfig } from "../scripts/deploy-guards.mjs";

const validConfig = {
  workers_dev: false,
  preview_urls: false,
  assets: { directory: "src/text-core/dict", binding: "ASSETS" },
};

test("private Text Worker config passes the deploy guard", () => {
  assert.equal(assertPrivateTextWorkerConfig(validConfig), true);
});

test("deploy guard rejects workers_dev", () => {
  assert.throws(
    () => assertPrivateTextWorkerConfig({ ...validConfig, workers_dev: true }),
    /workers_dev.*false/i,
  );
});

test("deploy guard rejects preview URLs", () => {
  assert.throws(
    () => assertPrivateTextWorkerConfig({ ...validConfig, preview_urls: true }),
    /preview_urls.*false/i,
  );
});

test("deploy guard rejects configured routes", () => {
  assert.throws(
    () => assertPrivateTextWorkerConfig({ ...validConfig, routes: [{ pattern: "example.test/*" }] }),
    /routes.*not be configured/i,
  );
});

test("deploy guard rejects configured route and domains fields", () => {
  assert.throws(
    () => assertPrivateTextWorkerConfig({ ...validConfig, route: "example.test/*" }),
    /route.*not be configured/i,
  );
  assert.throws(
    () => assertPrivateTextWorkerConfig({ ...validConfig, domains: ["example.test"] }),
    /domains.*not be configured/i,
  );
});
