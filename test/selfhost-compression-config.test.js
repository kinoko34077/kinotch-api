import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const configPath = path.join(projectRoot, "wrangler.semantic-compression.selfhost.jsonc");
const packagePath = path.join(projectRoot, "package.json");

test("self-host Wrangler config is loopback-only and has no production bindings", async () => {
  const config = JSON.parse(await readFile(configPath, "utf8"));

  assert.equal(config.name, "semantic-compression-selfhost");
  assert.equal(config.main, "src/semantic-compression-worker.js");
  assert.equal(config.compatibility_date, "2026-09-07");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.secrets?.required, ["GEMINI_API_KEY"]);
  assert.deepEqual(config.dev, {
    ip: "127.0.0.1",
    port: 8787,
    local_protocol: "http",
  });
  assert.deepEqual(config.vars, {
    ENABLE_REQUEST_LOGS: "false",
    GEMINI_TIMEOUT_MS: "45000",
  });

  for (const forbidden of [
    "account_id",
    "routes",
    "services",
    "ratelimits",
    "kv_namespaces",
    "observability",
    "access",
  ]) {
    assert.equal(config[forbidden], undefined, `${forbidden} must not be configured`);
  }
  assert.doesNotMatch(JSON.stringify(config), /workers\.dev|api\.kinotch|cloudflareaccess|Service Token/i);
});

test(".env.example contains only an empty user-owned Gemini key", async () => {
  const example = await readFile(path.join(projectRoot, ".env.example"), "utf8");
  assert.equal(example, "GEMINI_API_KEY=\n");
  assert.doesNotMatch(example, /CLOUDFLARE|COMPRESSION_API|TOKEN|SECRET|AIza/i);
});

test("package exposes only the bounded self-host launcher command", async () => {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(packageJson.scripts["selfhost:compression"], "node scripts/selfhost-compression.mjs");
  assert.equal(packageJson.dependencies.dotenv, undefined);
  assert.equal(packageJson.devDependencies.dotenv, undefined);
});

test("self-host additions do not introduce a second lockfile dependency tree", async () => {
  const packageLock = JSON.parse(await readFile(path.join(projectRoot, "package-lock.json"), "utf8"));
  assert.equal(packageLock.packages?.["node_modules/dotenv"], undefined);
});
