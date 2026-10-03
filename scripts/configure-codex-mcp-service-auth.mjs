import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CODEX_CONFIG_RELATIVE_PATH = join(".codex", "config.toml");
export const CODEX_CONFIG_DISPLAY_PATH = "%USERPROFILE%\\.codex\\config.toml";
export const SEMANTIC_COMPRESSOR_ENDPOINT = "https://semantic-compression-mcp.kinotch.workers.dev/mcp";
export const SEMANTIC_COMPRESSOR_SECTION = "[mcp_servers.semantic_compressor]";

const defaultHelperPath = fileURLToPath(new URL("./codex-mcp-access-headers.mjs", import.meta.url));

function tomlString(value) {
  return JSON.stringify(value);
}

export function buildSemanticCompressorSection({ helperPath = defaultHelperPath } = {}) {
  const normalizedHelperPath = helperPath.replaceAll("\\", "/");
  const helperCommand = `node \"${normalizedHelperPath}\"`;
  return [
    SEMANTIC_COMPRESSOR_SECTION,
    `url = ${tomlString(SEMANTIC_COMPRESSOR_ENDPOINT)}`,
    "enabled = true",
    'enabled_tools = ["compress_text"]',
    "tool_timeout_sec = 60",
    `http_headers_helper = ${tomlString(helperCommand)}`,
  ].join("\n");
}

export function updateCodexConfigText(sourceText, { helperPath = defaultHelperPath } = {}) {
  const normalizedSource = sourceText.replaceAll("\r\n", "\n");
  const sourceLines = normalizedSource.split("\n");
  const targetTable = "mcp_servers.semantic_compressor";

  const tableHeaders = sourceLines
    .map((line, index) => {
      const match = /^\[([^\[\]]+)\]$/u.exec(line.trim());
      return match ? { index, name: match[1].trim() } : null;
    })
    .filter(Boolean);

  const targetHeaders = tableHeaders.filter(
    ({ name }) => name === targetTable || name.startsWith(`${targetTable}.`),
  );
  const parentHeaders = targetHeaders.filter(({ name }) => name === targetTable);

  if (parentHeaders.length > 1) {
    throw new Error("Codex config contains multiple semantic_compressor sections");
  }

  const seenTargetHeaders = new Set();
  for (const { name } of targetHeaders) {
    if (seenTargetHeaders.has(name)) {
      throw new Error("Codex config contains duplicate semantic_compressor target table");
    }
    seenTargetHeaders.add(name);
  }

  const replacementLines = buildSemanticCompressorSection({ helperPath }).split("\n");

  if (targetHeaders.length === 0) {
    const trimmed = normalizedSource.replace(/\s+$/u, "");
    return `${trimmed}${trimmed.length > 0 ? "\n\n" : ""}${replacementLines.join("\n")}\n`;
  }

  const ranges = targetHeaders.map(({ index: start }) => {
    const nextHeader = tableHeaders.find(({ index }) => index > start);
    return { start, end: nextHeader?.index ?? sourceLines.length };
  });
  const firstTargetStart = ranges[0].start;
  const combined = [];
  let index = 0;
  let insertedReplacement = false;

  while (index < sourceLines.length) {
    const range = ranges.find(({ start }) => start === index);
    if (range) {
      if (!insertedReplacement) {
        while (combined.length > 0 && combined.at(-1) === "") combined.pop();
        if (combined.length > 0) combined.push("");
        combined.push(...replacementLines);
        insertedReplacement = true;
      }
      index = range.end;
      while (index < sourceLines.length && sourceLines[index] === "") index += 1;
      continue;
    }

    combined.push(sourceLines[index]);
    index += 1;
  }

  if (!insertedReplacement) {
    throw new Error(`Codex config subtree replacement failed at line ${firstTargetStart + 1}`);
  }

  return `${combined.join("\n").replace(/\s+$/u, "")}\n`;
}

export async function main(
  argv = process.argv.slice(2),
  {
    homeDirectory = homedir(),
    helperPath = defaultHelperPath,
    stdout = process.stdout,
    stderr = process.stderr,
  } = {},
) {
  try {
    if (argv.length !== 0) {
      throw new Error("Codex Service Auth setup does not accept arguments");
    }

    const configPath = join(homeDirectory, CODEX_CONFIG_RELATIVE_PATH);
    let sourceText = "";
    try {
      sourceText = await readFile(configPath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw new Error("Could not read Codex config");
    }

    const updated = updateCodexConfigText(sourceText, { helperPath });
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, updated, "utf8");
    stdout.write(`Codex semantic_compressor Service Auth helper configured: ${CODEX_CONFIG_DISPLAY_PATH}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : "Codex Service Auth setup failed"}\n`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
