import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function loadSetupModule() {
  return import("../scripts/configure-codex-mcp-service-auth.mjs");
}

test("Codex setup inserts a bounded semantic_compressor section without secret literals", async () => {
  const { updateCodexConfigText } = await loadSetupModule();
  const result = updateCodexConfigText("model = \"gpt-5.6\"\n", {
    helperPath: "C:\\Users\\fixture\\kinotch-api\\scripts\\codex-mcp-access-headers.mjs",
  });
  assert.match(result, /\[mcp_servers\.semantic_compressor\]/);
  assert.match(result, /url = \"https:\/\/semantic-compression-mcp\.kinotch\.workers\.dev\/mcp\"/);
  assert.match(result, /enabled = true/);
  assert.match(result, /enabled_tools = \[\"compress_text\"\]/);
  assert.match(result, /tool_timeout_sec = 60/);
  assert.match(result, /http_headers_helper = \"node \\\"C:\/Users\/fixture\/kinotch-api\/scripts\/codex-mcp-access-headers\.mjs\\\"\"/);
  assert.doesNotMatch(result, /CF_ACCESS_CLIENT_SECRET|CODEX_CF_ACCESS_CLIENT_SECRET/);
});

test("Codex setup replaces only the existing semantic_compressor scalar section", async () => {
  const { updateCodexConfigText } = await loadSetupModule();
  const source = [
    "model = \"gpt-5.6\"",
    "",
    "[mcp_servers.semantic_compressor]",
    "url = \"https://old.invalid/mcp\"",
    "auth = \"oauth\"",
    "enabled_tools = [\"old_tool\"]",
    "",
    "[mcp_servers.other]",
    "url = \"https://example.test/mcp\"",
    "",
  ].join("\n");
  const result = updateCodexConfigText(source, {
    helperPath: "C:\\repo\\scripts\\codex-mcp-access-headers.mjs",
  });
  assert.equal((result.match(/\[mcp_servers\.semantic_compressor\]/g) ?? []).length, 1);
  assert.doesNotMatch(result, /https:\/\/old\.invalid\/mcp|auth = \"oauth\"|old_tool/);
  assert.match(result, /\[mcp_servers\.other\][\s\S]*https:\/\/example\.test\/mcp/);
});

test("Codex setup fails closed on duplicate semantic_compressor sections", async () => {
  const { updateCodexConfigText } = await loadSetupModule();
  const source = [
    "[mcp_servers.semantic_compressor]",
    "url = \"https://one.invalid/mcp\"",
    "",
    "[mcp_servers.semantic_compressor]",
    "url = \"https://two.invalid/mcp\"",
    "",
  ].join("\n");
  assert.throws(
    () => updateCodexConfigText(source, { helperPath: "C:\\repo\\scripts\\codex-mcp-access-headers.mjs" }),
    /multiple semantic_compressor sections/,
  );
});

test("Codex setup main writes only the fixed user config path and accepts no arguments", async () => {
  const { main } = await loadSetupModule();
  const homeDirectory = await mkdtemp(join(tmpdir(), "kinotch-codex-setup-"));
  const codexDirectory = join(homeDirectory, ".codex");
  const configPath = join(codexDirectory, "config.toml");
  const stdout = [];
  const stderr = [];
  try {
    await mkdir(codexDirectory, { recursive: true });
    await writeFile(configPath, "model = \"gpt-5.6\"\n", "utf8");
    const status = await main([], {
      homeDirectory,
      helperPath: "C:\\repo\\scripts\\codex-mcp-access-headers.mjs",
      stdout: { write: (value) => stdout.push(value) },
      stderr: { write: (value) => stderr.push(value) },
    });
    assert.equal(status, 0);
    assert.equal(stderr.join(""), "");
    const config = await readFile(configPath, "utf8");
    assert.match(config, /http_headers_helper/);
    assert.doesNotMatch(config, /client-secret|CF_ACCESS_CLIENT_SECRET=/);

    const rejected = await main(["C:\\other.toml"], {
      homeDirectory,
      helperPath: "C:\\repo\\scripts\\codex-mcp-access-headers.mjs",
      stdout: { write: (value) => stdout.push(value) },
      stderr: { write: (value) => stderr.push(value) },
    });
    assert.equal(rejected, 1);
    assert.match(stderr.join(""), /does not accept arguments/);
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("package exposes one machine-local Codex Service Auth setup command", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(
    packageJson.scripts["setup:codex-mcp-service-auth"],
    "node scripts/configure-codex-mcp-service-auth.mjs",
  );
});
