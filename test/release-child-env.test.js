import test from "node:test";
import assert from "node:assert/strict";
import { createReleaseChildEnv } from "../scripts/release-child-env.mjs";

const sourceEnv = {
  PATH: "fixture-path",
  NODE_ENV: "production",
  MCP_SMOKE_ACCESS_COOKIE: "cookie-fixture",
  COMPRESSION_SMOKE_TOKEN: "smoke-token-fixture",
  GEMINI_API_KEY: "gemini-fixture",
  KINOTCH_COMPRESSION_GEMINI_API_KEY: "local-gemini-fixture",
  RUN_GEMINI_LIVE_TEST: "true",
  RUN_COMPRESSION_QUALITY_EVAL: "true",
  RUN_COMPRESSION_USAGE_MEASURE: "true",
  CLOUDFLARE_API_TOKEN: "cloudflare-token-fixture",
  CLOUDFLARE_API_KEY: "cloudflare-key-fixture",
  CLOUDFLARE_EMAIL: "operator@example.test",
  WRANGLER_API_TOKEN: "wrangler-token-fixture",
};

test("release child environment removes release secrets by default", () => {
  const childEnv = createReleaseChildEnv(sourceEnv);

  assert.deepEqual(childEnv, {
    PATH: "fixture-path",
    NODE_ENV: "production",
  });
  assert.equal(sourceEnv.MCP_SMOKE_ACCESS_COOKIE, "cookie-fixture");
});

test("Wrangler child environment restores only Cloudflare credentials", () => {
  const childEnv = createReleaseChildEnv(sourceEnv, { includeCloudflareCredentials: true });

  assert.equal(childEnv.PATH, "fixture-path");
  assert.equal(childEnv.CLOUDFLARE_API_TOKEN, "cloudflare-token-fixture");
  assert.equal(childEnv.CLOUDFLARE_API_KEY, "cloudflare-key-fixture");
  assert.equal(childEnv.CLOUDFLARE_EMAIL, "operator@example.test");
  assert.equal(childEnv.WRANGLER_API_TOKEN, "wrangler-token-fixture");
  assert.equal(childEnv.MCP_SMOKE_ACCESS_COOKIE, undefined);
  assert.equal(childEnv.COMPRESSION_SMOKE_TOKEN, undefined);
  assert.equal(childEnv.GEMINI_API_KEY, undefined);
  assert.equal(childEnv.KINOTCH_COMPRESSION_GEMINI_API_KEY, undefined);
  assert.equal(childEnv.RUN_GEMINI_LIVE_TEST, undefined);
  assert.equal(childEnv.RUN_COMPRESSION_QUALITY_EVAL, undefined);
  assert.equal(childEnv.RUN_COMPRESSION_USAGE_MEASURE, undefined);
});
