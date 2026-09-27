import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const configUrl = new URL("../.github/dependabot.yml", import.meta.url);

test("peer-coupled MCP dependencies are isolated from the blanket minor/patch group", async () => {
  const config = await readFile(configUrl, "utf8");
  assert.match(config, /mcp-peer-coupled:[\s\S]*patterns:[\s\S]*- "agents"[\s\S]*- "@modelcontextprotocol\/server"/);
  assert.match(config, /minor-and-patch:[\s\S]*exclude-patterns:[\s\S]*- "agents"[\s\S]*- "@modelcontextprotocol\/server"/);
});