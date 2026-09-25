import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_PRODUCTION_SECRET_KEYS,
  MAPPER_MODES,
  PRODUCTION_SECRET_RELATIVE_PATH,
  mapProductionSecrets,
  parseProductionSecretText,
  requiredKeysForMode,
} from "../scripts/production-secret-mapper.mjs";

const releaseSecrets = Object.freeze({
  TEAM_DOMAIN: "https://team.example.cloudflareaccess.com",
  POLICY_AUD: "audience-fixture-value",
  MCP_ENDPOINT: "https://semantic-compression-mcp.kinotch.workers.dev/mcp",
  CF_ACCESS_CLIENT_ID: "release-client-id-fixture",
  CF_ACCESS_CLIENT_SECRET: "release-client-secret-fixture",
  COMPRESSION_SMOKE_TOKEN: "compression-token-fixture",
  CLOUDFLARE_API_TOKEN: "cloudflare-api-token-fixture",
  JEV_AUDIT_MCP_POLICY_AUD: "jev-audit-audience-fixture",
  JEV_AUDIT_SMOKE_TOKEN: "jev-audit-token-fixture",
});

const codexSecrets = Object.freeze({
  CODEX_CF_ACCESS_CLIENT_ID: "codex-client-id-fixture",
  CODEX_CF_ACCESS_CLIENT_SECRET: "codex-client-secret-fixture",
});

const sharedSecretText = Object.entries({ ...releaseSecrets, ...codexSecrets })
  .map(([key, value]) => `${key}=${value}`)
  .join("\n");

const helperScript = fileURLToPath(new URL("../scripts/codex-mcp-access-headers.mjs", import.meta.url));

async function createSecretHome(contents) {
  const homeDirectory = await mkdtemp(join(tmpdir(), "kinotch-codex-mcp-helper-"));
  await mkdir(join(homeDirectory, ".kinotch-secrets"), { recursive: true });
  await writeFile(join(homeDirectory, PRODUCTION_SECRET_RELATIVE_PATH), contents, "utf8");
  return homeDirectory;
}

function runHelper(homeDirectory, args = []) {
  return spawnSync(process.execPath, [helperScript, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: homeDirectory, USERPROFILE: homeDirectory },
  });
}

test("shared secret parser retains Codex credentials while production release keys stay unchanged", () => {
  const parsed = parseProductionSecretText(sharedSecretText);
  assert.equal(parsed.CODEX_CF_ACCESS_CLIENT_ID, codexSecrets.CODEX_CF_ACCESS_CLIENT_ID);
  assert.equal(parsed.CODEX_CF_ACCESS_CLIENT_SECRET, codexSecrets.CODEX_CF_ACCESS_CLIENT_SECRET);
  assert.deepEqual(requiredKeysForMode(MAPPER_MODES.PRODUCTION_RELEASE), [...ALLOWED_PRODUCTION_SECRET_KEYS]);
});

test("production release mapping never forwards Codex-only credentials", () => {
  const parsed = parseProductionSecretText(sharedSecretText);
  const mapped = mapProductionSecrets(parsed, MAPPER_MODES.PRODUCTION_RELEASE);
  assert.deepEqual(mapped, releaseSecrets);
  assert.equal(mapped.CODEX_CF_ACCESS_CLIENT_ID, undefined);
  assert.equal(mapped.CODEX_CF_ACCESS_CLIENT_SECRET, undefined);
});

test("Codex MCP helper emits exactly the two Cloudflare Access headers as JSON", async () => {
  const homeDirectory = await createSecretHome(`${sharedSecretText}\nUNRELATED_SECRET=ignored-value`);
  try {
    const result = runHelper(homeDirectory);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      "CF-Access-Client-Id": codexSecrets.CODEX_CF_ACCESS_CLIENT_ID,
      "CF-Access-Client-Secret": codexSecrets.CODEX_CF_ACCESS_CLIENT_SECRET,
    });
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("Codex MCP helper fails safely when either Codex credential is missing", async () => {
  const releaseText = Object.entries(releaseSecrets).map(([key, value]) => `${key}=${value}`).join("\n");
  const homeDirectory = await createSecretHome(`${releaseText}\nCODEX_CF_ACCESS_CLIENT_ID=${codexSecrets.CODEX_CF_ACCESS_CLIENT_ID}`);
  try {
    const result = runHelper(homeDirectory);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /CODEX_CF_ACCESS_CLIENT_SECRET/);
    assert.doesNotMatch(result.stderr, /codex-client-id-fixture|release-client-secret-fixture/);
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("Codex MCP helper rejects arguments instead of accepting alternate secret paths", async () => {
  const homeDirectory = await createSecretHome(sharedSecretText);
  try {
    const result = runHelper(homeDirectory, ["C:\\other-secret.env"]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /does not accept arguments/);
    assert.doesNotMatch(result.stderr, /codex-client-secret-fixture/);
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});
