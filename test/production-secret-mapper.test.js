import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALLOWED_PRODUCTION_SECRET_KEYS,
  MAPPER_MODES,
  PRODUCTION_SECRET_RELATIVE_PATH,
  createMappedChildEnv,
  getProductionSecretPath,
  loadProductionSecrets,
  main,
  mapProductionSecrets,
  parseProductionSecretText,
  requiredKeysForMode,
  runMappedCommand,
} from "../scripts/production-secret-mapper.mjs";

const secretValues = Object.freeze({
  TEAM_DOMAIN: "https://team.example.cloudflareaccess.com",
  POLICY_AUD: "audience-fixture-value",
  MCP_ENDPOINT: "https://semantic-compression-mcp.kinotch.workers.dev/mcp",
  CF_ACCESS_CLIENT_ID: "client-id-fixture-value",
  CF_ACCESS_CLIENT_SECRET: "client-secret-fixture-value",
  COMPRESSION_SMOKE_TOKEN: "compression-token-fixture-value",
  CLOUDFLARE_API_TOKEN: "cloudflare-api-token-fixture-value",
  JEV_AUDIT_MCP_POLICY_AUD: "jev-audit-audience-fixture-value",
  JEV_AUDIT_SMOKE_TOKEN: "jev-audit-token-fixture-value",
});

const secretText = Object.entries(secretValues)
  .map(([key, value]) => `${key}=${value}`)
  .join("\n");

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const operatorDocumentation = await Promise.all([
  readFile(new URL("../README.md", import.meta.url), "utf8"),
  readFile(new URL("../docs/USAGE.md", import.meta.url), "utf8"),
  readFile(new URL("../docs/OPERATIONS.md", import.meta.url), "utf8"),
]);

async function createSyntheticSecretHome(contents = secretText) {
  const homeDirectory = await mkdtemp(join(tmpdir(), "kinotch-secret-mapper-"));
  const secretPath = join(homeDirectory, PRODUCTION_SECRET_RELATIVE_PATH);
  await writeFile(secretPath, contents, "utf8").catch(async (error) => {
    if (error.code !== "ENOENT") throw error;
    await import("node:fs/promises").then(({ mkdir }) => mkdir(join(homeDirectory, ".kinotch-secrets"), { recursive: true }));
    await writeFile(secretPath, contents, "utf8");
  });
  return { homeDirectory, secretPath };
}

function fakeSpawn(exitCode, capture) {
  return (command, args, options) => {
    capture.push({ command, args, options });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", exitCode, null));
    return child;
  };
}

test("production secret parser accepts supported core/Jev keys and ignores unrelated keys", () => {
  assert.deepEqual(Object.keys(secretValues), [...ALLOWED_PRODUCTION_SECRET_KEYS]);
  assert.deepEqual(
    parseProductionSecretText(`${secretText}\nUNRELATED_SECRET=ignored-fixture-value`),
    secretValues,
  );
});

test("production secret path is fixed below the supplied home directory", () => {
  const homeDirectory = "C:\\synthetic-home";
  assert.equal(getProductionSecretPath({ homeDirectory }), join(homeDirectory, PRODUCTION_SECRET_RELATIVE_PATH));
});

test("mode mapping exposes only the required keys and adds Jev inputs only to production", () => {
  assert.deepEqual(requiredKeysForMode(MAPPER_MODES.MCP_SMOKE), [
    "MCP_ENDPOINT",
    "CF_ACCESS_CLIENT_ID",
    "CF_ACCESS_CLIENT_SECRET",
  ]);
  assert.deepEqual(mapProductionSecrets(secretValues, MAPPER_MODES.MCP_SMOKE), {
    MCP_ENDPOINT: secretValues.MCP_ENDPOINT,
    CF_ACCESS_CLIENT_ID: secretValues.CF_ACCESS_CLIENT_ID,
    CF_ACCESS_CLIENT_SECRET: secretValues.CF_ACCESS_CLIENT_SECRET,
  });
  assert.deepEqual(mapProductionSecrets(secretValues, MAPPER_MODES.PRODUCTION_RELEASE), secretValues);
});

test("missing secret file fails without exposing its path or values", async () => {
  const homeDirectory = await mkdtemp(join(tmpdir(), "kinotch-secret-mapper-missing-"));
  try {
    await assert.rejects(
      loadProductionSecrets({ homeDirectory }),
      (error) => error.message.includes("%USERPROFILE%") && !error.message.includes("fixture-value"),
    );
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("missing service-token credentials fail before a child process can start", async () => {
  const calls = [];
  await assert.rejects(
    runMappedCommand(MAPPER_MODES.MCP_SMOKE, {
      secrets: { MCP_ENDPOINT: secretValues.MCP_ENDPOINT, CF_ACCESS_CLIENT_ID: secretValues.CF_ACCESS_CLIENT_ID },
      spawnImpl: fakeSpawn(0, calls),
    }),
    /Missing required production secret keys:[\s\S]*CF_ACCESS_CLIENT_SECRET/,
  );
  assert.equal(calls.length, 0);
});

test("legacy cookie and unrelated keys are ignored and never mapped", () => {
  const parsed = parseProductionSecretText(
    `${secretText}\nMCP_SMOKE_ACCESS_COOKIE=legacy-core-cookie\nJEV_AUDIT_MCP_SMOKE_ACCESS_COOKIE=legacy-jev-cookie\nUNRELATED_SECRET=unknown-secret-fixture-value`,
  );
  assert.deepEqual(parsed, secretValues);
  assert.equal(parsed.MCP_SMOKE_ACCESS_COOKIE, undefined);
  assert.equal(parsed.JEV_AUDIT_MCP_SMOKE_ACCESS_COOKIE, undefined);
  assert.equal(parsed.UNRELATED_SECRET, undefined);
});

test("unknown mapper mode fails closed", () => {
  assert.throws(() => requiredKeysForMode("arbitrary-command"), /Unknown production secret mapper mode: arbitrary-command/);
});

test("mapped MCP child environment preserves service-token values but excludes release-only secrets", () => {
  const childEnv = createMappedChildEnv({
    mode: MAPPER_MODES.MCP_SMOKE,
    sourceEnv: {
      PATH: "fixture-path",
      NODE_ENV: "production",
      UNRELATED_SECRET: "must-not-reach-child",
      CLOUDFLARE_API_TOKEN: "must-not-reach-mcp-smoke",
    },
    secrets: secretValues,
  });
  assert.equal(childEnv.PATH, "fixture-path");
  assert.equal(childEnv.NODE_ENV, "production");
  assert.equal(childEnv.MCP_ENDPOINT, secretValues.MCP_ENDPOINT);
  assert.equal(childEnv.CF_ACCESS_CLIENT_ID, secretValues.CF_ACCESS_CLIENT_ID);
  assert.equal(childEnv.CF_ACCESS_CLIENT_SECRET, secretValues.CF_ACCESS_CLIENT_SECRET);
  assert.equal(childEnv.COMPRESSION_SMOKE_TOKEN, undefined);
  assert.equal(childEnv.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(childEnv.JEV_AUDIT_MCP_POLICY_AUD, undefined);
  assert.equal(childEnv.JEV_AUDIT_SMOKE_TOKEN, undefined);
  assert.equal(childEnv.MCP_SMOKE_ACCESS_COOKIE, undefined);
  assert.equal(childEnv.JEV_AUDIT_MCP_SMOKE_ACCESS_COOKIE, undefined);
  assert.equal(childEnv.UNRELATED_SECRET, undefined);
});

test("production-release maps all supported keys and launches the Jev-aware release authority", async () => {
  const calls = [];
  const exitCode = await runMappedCommand(MAPPER_MODES.PRODUCTION_RELEASE, {
    secrets: secretValues,
    sourceEnv: {
      PATH: "fixture-path",
      CLOUDFLARE_API_TOKEN: "stale-source-env-token",
      CLOUDFLARE_API_KEY: "stale-global-api-key",
      CLOUDFLARE_EMAIL: "stale-email@example.test",
      WRANGLER_API_TOKEN: "stale-wrangler-token",
    },
    spawnImpl: fakeSpawn(0, calls),
  });
  assert.equal(exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.join(" ").includes("deploy:production"), true);
  for (const [key, value] of Object.entries(secretValues)) assert.equal(calls[0].options.env[key], value);
  assert.equal(calls[0].options.env.MCP_SMOKE_ACCESS_COOKIE, undefined);
  assert.equal(calls[0].options.env.JEV_AUDIT_MCP_SMOKE_ACCESS_COOKIE, undefined);
  assert.equal(calls[0].options.env.CLOUDFLARE_API_KEY, undefined);
  assert.equal(calls[0].options.env.CLOUDFLARE_EMAIL, undefined);
  assert.equal(calls[0].options.env.WRANGLER_API_TOKEN, undefined);
});

test("mcp-smoke launches the existing smoke authority and propagates child failure", async () => {
  const calls = [];
  const exitCode = await runMappedCommand(MAPPER_MODES.MCP_SMOKE, {
    secrets: secretValues,
    sourceEnv: { PATH: "fixture-path" },
    spawnImpl: fakeSpawn(17, calls),
  });
  assert.equal(exitCode, 17);
  assert.equal(calls[0].args.join(" ").includes("smoke:mcp"), true);
  assert.equal(calls[0].options.env.COMPRESSION_SMOKE_TOKEN, undefined);
  assert.equal(calls[0].options.env.JEV_AUDIT_SMOKE_TOKEN, undefined);
});

test("mapper main keeps synthetic secret values out of stdout and stderr", async () => {
  const { homeDirectory } = await createSyntheticSecretHome();
  const stdout = [];
  const stderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  try {
    console.log = (...args) => stdout.push(args.join(" "));
    console.error = (...args) => stderr.push(args.join(" "));
    const calls = [];
    const status = await main([MAPPER_MODES.MCP_SMOKE], {
      homeDirectory,
      sourceEnv: { PATH: "fixture-path" },
      spawnImpl: fakeSpawn(0, calls),
    });
    assert.equal(status, 0);
    assert.equal(calls.length, 1);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    await rm(homeDirectory, { recursive: true, force: true });
  }
  const output = `${stdout.join("\n")}\n${stderr.join("\n")}`;
  for (const value of Object.values(secretValues)) assert.doesNotMatch(output, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("mapper main rejects an alternate path argument before reading any file", async () => {
  const calls = [];
  const stderr = [];
  const originalError = console.error;
  try {
    console.error = (...args) => stderr.push(args.join(" "));
    const status = await main([MAPPER_MODES.MCP_SMOKE, "C:\\other-secret.env"], { spawnImpl: fakeSpawn(0, calls) });
    assert.equal(status, 1);
  } finally {
    console.error = originalError;
  }
  assert.equal(calls.length, 0);
  assert.match(stderr.join("\n"), /exactly one supported mode argument/);
});

test("package scripts preserve fixed mapper modes and route production through the Jev wrapper", () => {
  assert.equal(packageJson.scripts["smoke:mcp:local"], "node scripts/production-secret-mapper.mjs mcp-smoke");
  assert.equal(packageJson.scripts["release:local"], "node scripts/production-secret-mapper.mjs production-release");
  assert.equal(packageJson.scripts["smoke:mcp"], "node scripts/smoke-mcp.mjs");
  assert.equal(packageJson.scripts["deploy:production"], "node scripts/deploy-production-with-jev-audit.mjs");
  assert.equal(packageJson.scripts.deploy, "npm run deploy:production");
});

test("operator documentation preserves the mapper workflow and service-token auth without secret values", () => {
  const documentation = operatorDocumentation.join("\n");
  assert.match(documentation, /production-secret-mapper\.mjs/);
  assert.match(documentation, /kinotch-api\.production\.env/);
  assert.match(documentation, /npm run smoke:mcp:local/);
  assert.match(documentation, /npm run release:local/);
  assert.match(documentation, /npm run deploy:production/);
  assert.match(documentation, /TEAM_DOMAIN/);
  assert.match(documentation, /CF_ACCESS_CLIENT_ID/);
  assert.match(documentation, /CF_ACCESS_CLIENT_SECRET/);
  assert.match(documentation, /COMPRESSION_SMOKE_TOKEN/);
  assert.match(documentation, /CLOUDFLARE_API_TOKEN/);
  assert.match(documentation, /JEV_AUDIT_MCP_POLICY_AUD/);
  assert.match(documentation, /JEV_AUDIT_SMOKE_TOKEN/);
  assert.doesNotMatch(documentation, /(^|[^A-Z0-9_])MCP_SMOKE_ACCESS_COOKIE([^A-Z0-9_]|$)/m);
  assert.doesNotMatch(documentation, /(^|[^A-Z0-9_])JEV_AUDIT_MCP_SMOKE_ACCESS_COOKIE([^A-Z0-9_]|$)/m);
  assert.doesNotMatch(documentation, /CF_Authorization=[A-Za-z0-9_-]{8,}/);
});
