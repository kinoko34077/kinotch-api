import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPrivateTextWorkerConfig,
  assertPrivateWorkerConfig,
} from "../scripts/deploy-guards.mjs";

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

const validCompressionConfig = {
  workers_dev: false,
  preview_urls: false,
  vars: { ENABLE_REQUEST_LOGS: "true" },
};

test("private generic Worker config passes for semantic-compression", () => {
  assert.equal(assertPrivateWorkerConfig(validCompressionConfig, "semantic-compression"), true);
});

test("generic deploy guard names the protected Worker and violated field", () => {
  assert.throws(
    () => assertPrivateWorkerConfig({ ...validCompressionConfig, workers_dev: true }, "semantic-compression"),
    /semantic-compression.*workers_dev.*false/i,
  );
  assert.throws(
    () => assertPrivateWorkerConfig({ ...validCompressionConfig, preview_urls: true }, "semantic-compression"),
    /semantic-compression.*preview_urls.*false/i,
  );
  assert.throws(
    () => assertPrivateWorkerConfig({ ...validCompressionConfig, routes: [{ pattern: "example.test/*" }] }, "semantic-compression"),
    /semantic-compression.*routes.*not be configured/i,
  );
});
