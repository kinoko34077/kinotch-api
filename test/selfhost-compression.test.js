import assert from "node:assert/strict";
import test from "node:test";

import {
  SELFHOST_ENV_FILENAME,
  SELFHOST_SECRET_KEYS,
  createSelfHostChildEnv,
  loadSelfHostSecrets,
  main,
  parseSelfHostEnv,
  resolveSelfHostInvocation,
  runSelfHostCommand,
} from "../scripts/selfhost-compression.mjs";

const projectRoot = "C:\\fixture\\kinotch-api";

function createSpawnFixture({ exitCode = 0 } = {}) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    return {
      on(event, callback) {
        if (event === "close") callback(exitCode, null);
        return this;
      },
    };
  };
  return { calls, spawnImpl };
}

test("parseSelfHostEnv accepts only the user-owned Gemini key", () => {
  const parsed = parseSelfHostEnv(
    "GEMINI_API_KEY = \"fixture key\"\nUNRELATED_SECRET=must-ignore\n",
  );

  assert.deepEqual(parsed, { GEMINI_API_KEY: "fixture key" });
  assert.deepEqual(SELFHOST_SECRET_KEYS, ["GEMINI_API_KEY"]);
  assert.equal(SELFHOST_ENV_FILENAME, ".env");
  assert.ok(Object.isFrozen(parsed));
});

test("parseSelfHostEnv follows Node dotenv parsing for quoted and whitespace values", () => {
  const parsed = parseSelfHostEnv(
    "  GEMINI_API_KEY=  'fixture key'  \n",
  );

  assert.equal(parsed.GEMINI_API_KEY, "fixture key");
});

test("parseSelfHostEnv rejects malformed dotenv without exposing source values", () => {
  assert.throws(
    () => parseSelfHostEnv("GEMINI_API_KEY=\"unterminated-secret"),
    /Could not parse self-host \.env/,
  );
});

test("parseSelfHostEnv rejects a missing or empty key safely", () => {
  for (const source of ["", "OTHER=value", "GEMINI_API_KEY=   "]) {
    assert.throws(
      () => parseSelfHostEnv(source),
      /GEMINI_API_KEY is required in the repository-root \.env/,
    );
  }
});

test("loadSelfHostSecrets rejects root .dev.vars files before reading .env", async () => {
  let readCount = 0;
  await assert.rejects(
    loadSelfHostSecrets({
      projectRoot,
      readdirImpl: async () => [".dev.vars.local", ".env"],
      readFileImpl: async () => {
        readCount += 1;
        return "GEMINI_API_KEY=should-not-be-read";
      },
    }),
    /Root \.dev\.vars files are unsupported/,
  );
  assert.equal(readCount, 0);
});

test("loadSelfHostSecrets reads only the repository-root .env", async () => {
  const secrets = await loadSelfHostSecrets({
    projectRoot,
    readdirImpl: async () => [".env"],
    readFileImpl: async (filePath) => {
      assert.equal(filePath, `${projectRoot}\\.env`);
      return "GEMINI_API_KEY=fixture-key\nOTHER=ignored";
    },
  });

  assert.deepEqual(secrets, { GEMINI_API_KEY: "fixture-key" });
});

test("createSelfHostChildEnv is an allowlisted child environment", () => {
  const childEnv = createSelfHostChildEnv({
    sourceEnv: {
      PATH: "fixture-path",
      USERPROFILE: "fixture-user",
      GEMINI_API_KEY: "wrong-inherited-key",
      CLOUDFLARE_API_TOKEN: "must-not-reach-child",
      COMPRESSION_SMOKE_TOKEN: "must-not-reach-child",
      UNRELATED_SECRET: "must-not-reach-child",
    },
    secrets: { GEMINI_API_KEY: "fixture-key" },
  });

  assert.equal(childEnv.PATH, "fixture-path");
  assert.equal(childEnv.USERPROFILE, "fixture-user");
  assert.equal(childEnv.GEMINI_API_KEY, "fixture-key");
  assert.equal(childEnv.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, "false");
  assert.equal(childEnv.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(childEnv.COMPRESSION_SMOKE_TOKEN, undefined);
  assert.equal(childEnv.UNRELATED_SECRET, undefined);
});

test("resolveSelfHostInvocation is fixed to local Wrangler dev", () => {
  const invocation = resolveSelfHostInvocation({ projectRoot });

  assert.equal(invocation.shell, false);
  assert.deepEqual(invocation.args.slice(1), [
    "dev",
    "--local",
    "--config",
    "wrangler.semantic-compression.selfhost.jsonc",
  ]);
  assert.equal(invocation.args.includes("--remote"), false);
  assert.equal(invocation.args.includes("deploy"), false);
});

test("runSelfHostCommand passes the bounded environment and child exit code", async () => {
  const { calls, spawnImpl } = createSpawnFixture({ exitCode: 17 });
  const exitCode = await runSelfHostCommand({
    projectRoot,
    sourceEnv: { PATH: "fixture-path", CLOUDFLARE_API_TOKEN: "hidden" },
    secrets: { GEMINI_API_KEY: "fixture-key" },
    spawnImpl,
  });

  assert.equal(exitCode, 17);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.cwd, projectRoot);
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].options.stdio, "inherit");
  assert.equal(calls[0].options.env.GEMINI_API_KEY, "fixture-key");
  assert.equal(calls[0].options.env.CLOUDFLARE_API_TOKEN, undefined);
});

test("main rejects arbitrary arguments before spawning", async () => {
  const { calls, spawnImpl } = createSpawnFixture();
  const errors = [];
  const code = await main(["--remote"], {
    projectRoot,
    sourceEnv: {},
    readdirImpl: async () => [".env"],
    readFileImpl: async () => "GEMINI_API_KEY=fixture-key",
    spawnImpl,
    writeError: (message) => errors.push(message),
  });

  assert.equal(code, 2);
  assert.equal(calls.length, 0);
  assert.deepEqual(errors, ["selfhost:compression does not accept command-line arguments"]);
});

test("main returns a safe nonzero result when the key is absent and does not spawn", async () => {
  const { calls, spawnImpl } = createSpawnFixture();
  const errors = [];
  const code = await main([], {
    projectRoot,
    sourceEnv: {},
    readdirImpl: async () => [".env"],
    readFileImpl: async () => "OTHER=value",
    spawnImpl,
    writeError: (message) => errors.push(message),
  });

  assert.notEqual(code, 0);
  assert.equal(calls.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /GEMINI_API_KEY/);
  assert.doesNotMatch(errors.join("\n"), /fixture|secret|token/i);
});

test("main returns a safe nonzero result when spawning fails", async () => {
  const errors = [];
  const code = await main([], {
    projectRoot,
    sourceEnv: {},
    readdirImpl: async () => [".env"],
    readFileImpl: async () => "GEMINI_API_KEY=fixture-key",
    spawnImpl: () => {
      throw new Error("fixture-key must not be reported");
    },
    writeError: (message) => errors.push(message),
  });

  assert.notEqual(code, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0], "selfhost:compression failed to start the local Worker");
  assert.doesNotMatch(errors.join("\n"), /fixture-key/);
});
