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

function parseTableHeader(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;

  const array = trimmed.startsWith("[[") && trimmed.endsWith("]]");
  const name = array
    ? trimmed.slice(2, -2).trim()
    : trimmed.slice(1, -1).trim();
  return { array, name };
}

function isSemanticCompressorTable(name) {
  return (
    name === "mcp_servers.semantic_compressor"
    || name.startsWith("mcp_servers.semantic_compressor.")
  );
}

export function updateCodexConfigText(sourceText, { helperPath = defaultHelperPath } = {}) {
  const normalizedSource = sourceText.replaceAll("\r\n", "\n");
  const sourceLines = normalizedSource.split("\n");
  const headers = sourceLines
    .map((line, index) => ({ index, header: parseTableHeader(line) }))
    .filter(({ header }) => header !== null);
  const targetHeaders = headers.filter(({ header }) => isSemanticCompressorTable(header.name));
  const parentHeaders = targetHeaders.filter(
    ({ header }) => !header.array && header.name === "mcp_servers.semantic_compressor",
  );

  if (parentHeaders.length > 1) {
    throw new Error("Codex config contains multiple semantic_compressor sections");
  }

  const seenTargetNames = new Set();
  for (const { header } of targetHeaders) {
    if (header.array) {
      throw new Error("Codex config contains ambiguous semantic_compressor target table");
    }
    if (seenTargetNames.has(header.name)) {
      throw new Error("Codex config contains duplicate semantic_compressor target table");
    }
    seenTargetNames.add(header.name);
  }

  const replacementLines = buildSemanticCompressorSection({ helperPath }).split("\n");

  if (targetHeaders.length === 0) {
    const trimmed = normalizedSource.replace(/\s+$/u, "");
    return `${trimmed}${trimmed.length > 0 ? "\n\n" : ""}${replacementLines.join("\n")}\n`;
  }

  const remove = new Set();
  const targetStarts = new Set(targetHeaders.map(({ index }) => index));
  for (let headerIndex = 0; headerIndex < headers.length; headerIndex += 1) {
    const start = headers[headerIndex].index;
    if (!targetStarts.has(start)) continue;
    const end = headerIndex + 1 < headers.length
      ? headers[headerIndex + 1].index
      : sourceLines.length;
    for (let index = start; index < end; index += 1) {
      remove.add(index);
    }
  }

  const insertionIndex = Math.min(...targetStarts);
  const before = sourceLines
    .slice(0, insertionIndex)
    .filter((_, index) => !remove.has(index));
  const after = sourceLines
    .slice(insertionIndex)
    .filter((_, relativeIndex) => !remove.has(insertionIndex + relativeIndex));

  while (before.length > 0 && before.at(-1) === "") before.pop();
  while (after.length > 0 && after[0] === "") after.shift();

  const combined = [
    ...before,
    ...(before.length > 0 ? [""] : []),
    ...replacementLines,
    ...(after.length > 0 ? [""] : []),
    ...after,
  ];
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
