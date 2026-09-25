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
  MCP_SMOKE_ACCESS_COOKIE: "CF_Authorization=cookie-fixture-value",
  COMPRESSION_SMOKE_TOKEN: "compression-token-fixture-value",
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

test("production secret parser accepts exactly the five allowlisted keys", () => {
  assert.deepEqual(Object.keys(secretValues), [...ALLOWED_PRODUCTION_SECRET_KEYS]);
  assert.deepEqual(parseProductionSecretText(secretText), secretValues);
});

test("production secret path is fixed below the supplied home directory", () => {
  const homeDirectory = "C:\\synthetic-home";
  assert.equal(
    getProductionSecretPath({ homeDirectory }),
    join(homeDirectory, PRODUCTION_SECRET_RELATIVE_PATH),
  );
});

test("mode mapping exposes only the required keys", () => {
  assert.deepEqual(requiredKeysForMode(MAPPER_MODES.MCP_SMOKE), [
    "MCP_ENDPOINT",
    "MCP_SMOKE_ACCESS_COOKIE",
  ]);
  assert.deepEqual(mapProductionSecrets(secretValues, MAPPER_MODES.MCP_SMOKE), {
    MCP_ENDPOINT: secretValues.MCP_ENDPOINT,
    MCP_SMOKE_ACCESS_COOKIE: secretValues.MCP_SMOKE_ACCESS_COOKIE,
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

test("missing required keys fail before a child process can start", async () => {
  const calls = [];
  await assert.rejects(
    runMappedCommand(MAPPER_MODES.MCP_SMOKE, {
      secrets: { MCP_ENDPOINT: secretValues.MCP_ENDPOINT },
      spawnImpl: fakeSpawn(0, calls),
    }),
    /Missing required production secret keys:[\s\S]*MCP_SMOKE_ACCESS_COOKIE/,
  );
  assert.equal(calls.length, 0);
});

test("unknown secret keys fail closed without exposing values", () => {
  const unknownValue = "unknown-secret-fixture-value";
  assert.throws(
    () => parseProductionSecretText(`${secretText}\nUNRELATED_SECRET=${unknownValue}`),
    (error) => error.message.includes("UNRELATED_SECRET") && !error.message.includes(unknownValue),
  );
});

test("unknown mapper mode fails closed", () => {
  assert.throws(
    () => requiredKeysForMode("arbitrary-command"),
    /Unknown production secret mapper mode: arbitrary-command/,
  );
});

test("mapped child environment preserves safe runtime values but not unrelated secrets", () => {
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
  assert.equal(childEnv.MCP_SMOKE_ACCESS_COOKIE, secretValues.MCP_SMOKE_ACCESS_COOKIE);
  assert.equal(childEnv.COMPRESSION_SMOKE_TOKEN, undefined);
  assert.equal(childEnv.UNRELATED_SECRET, undefined);
  assert.equal(childEnv.CLOUDFLARE_API_TOKEN, undefined);
});

test("production-release maps five keys and launches the existing release authority", async () => {
  const calls = [];
  const exitCode = await runMappedCommand(MAPPER_MODES.PRODUCTION_RELEASE, {
    secrets: secretValues,
    sourceEnv: { PATH: "fixture-path", CLOUDFLARE_API_TOKEN: "cloudflare-fixture" },
    spawnImpl: fakeSpawn(0, calls),
  });
  assert.equal(exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.join(" "), "run deploy:production");
  assert.equal(calls[0].options.env.TEAM_DOMAIN, secretValues.TEAM_DOMAIN);
  assert.equal(calls[0].options.env.POLICY_AUD, secretValues.POLICY_AUD);
  assert.equal(calls[0].options.env.MCP_ENDPOINT, secretValues.MCP_ENDPOINT);
  assert.equal(calls[0].options.env.MCP_SMOKE_ACCESS_COOKIE, secretValues.MCP_SMOKE_ACCESS_COOKIE);
  assert.equal(calls[0].options.env.COMPRESSION_SMOKE_TOKEN, secretValues.COMPRESSION_SMOKE_TOKEN);
  assert.equal(calls[0].options.env.CLOUDFLARE_API_TOKEN, "cloudflare-fixture");
});

test("mcp-smoke launches the existing smoke authority and propagates child failure", async () => {
  const calls = [];
  const exitCode = await runMappedCommand(MAPPER_MODES.MCP_SMOKE, {
    secrets: secretValues,
    sourceEnv: { PATH: "fixture-path" },
    spawnImpl: fakeSpawn(17, calls),
  });
  assert.equal(exitCode, 17);
  assert.equal(calls[0].args.join(" "), "run smoke:mcp");
  assert.equal(calls[0].options.env.COMPRESSION_SMOKE_TOKEN, undefined);
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
    const status = await main([MAPPER_MODES.MCP_SMOKE, "C:\\other-secret.env"], {
      spawnImpl: fakeSpawn(0, calls),
    });
    assert.equal(status, 1);
  } finally {
    console.error = originalError;
  }
  assert.equal(calls.length, 0);
  assert.match(stderr.join("\n"), /exactly one supported mode argument/);
});

test("package scripts expose only the two fixed local mapper modes", () => {
  assert.equal(packageJson.scripts["smoke:mcp:local"], "node scripts/production-secret-mapper.mjs mcp-smoke");
  assert.equal(packageJson.scripts["release:local"], "node scripts/production-secret-mapper.mjs production-release");
  assert.equal(packageJson.scripts["smoke:mcp"], "node scripts/smoke-mcp.mjs");
  assert.equal(packageJson.scripts["deploy:production"], "node scripts/deploy-production.mjs");
  assert.equal(packageJson.scripts.deploy, "npm run deploy:production");
});

test("operator documentation explains the fixed mapper workflow without secret values", () => {
  const documentation = operatorDocumentation.join("\n");
  assert.match(documentation, /production-secret-mapper\.mjs/);
  assert.match(documentation, /kinotch-api\.production\.env/);
  assert.match(documentation, /npm run smoke:mcp:local/);
  assert.match(documentation, /npm run release:local/);
  assert.match(documentation, /npm run deploy:production/);
  assert.match(documentation, /TEAM_DOMAIN/);
  assert.match(documentation, /COMPRESSION_SMOKE_TOKEN/);
  assert.doesNotMatch(documentation, /CF_Authorization=[A-Za-z0-9_-]{8,}/);
});
