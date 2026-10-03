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
  const targetName = "mcp_servers.semantic_compressor";
  const descendantPrefix = `${targetName}.`;

  function tableHeader(line) {
    const trimmed = line.trim();
    const table = /^\[([^\[\]]+)\]$/u.exec(trimmed);
    if (table) return { name: table[1].trim(), array: false, raw: trimmed };
    const arrayTable = /^\[\[([^\[\]]+)\]\]$/u.exec(trimmed);
    if (arrayTable) return { name: arrayTable[1].trim(), array: true, raw: trimmed };
    return null;
  }

  const headers = sourceLines
    .map((line, index) => ({ index, header: tableHeader(line) }))
    .filter(({ header }) => header !== null);
  const targetHeaders = headers.filter(
    ({ header }) => header.name === targetName || header.name.startsWith(descendantPrefix),
  );
  const parentHeaders = targetHeaders.filter(({ header }) => header.name === targetName);

  if (parentHeaders.length > 1) {
    throw new Error("Codex config contains multiple semantic_compressor sections");
  }

  const descendantHeaders = targetHeaders.filter(({ header }) => header.name !== targetName);
  if (parentHeaders.length === 0 && descendantHeaders.length > 0) {
    throw new Error("Codex config contains an ambiguous semantic_compressor subtree");
  }

  if (parentHeaders.length === 1 && parentHeaders[0].header.raw !== SEMANTIC_COMPRESSOR_SECTION) {
    throw new Error("Codex config contains an ambiguous semantic_compressor subtree");
  }

  const targetHeaderCounts = new Map();
  for (const { header } of descendantHeaders) {
    const key = `${header.array ? "[[" : "["}${header.name}${header.array ? "]]" : "]"}`;
    const count = (targetHeaderCounts.get(key) ?? 0) + 1;
    targetHeaderCounts.set(key, count);
    if (count > 1) {
      throw new Error("Codex config contains an ambiguous semantic_compressor subtree");
    }
  }

  const replacementLines = buildSemanticCompressorSection({ helperPath }).split("\n");

  if (parentHeaders.length === 0) {
    const trimmed = normalizedSource.replace(/\s+$/u, "");
    return `${trimmed}${trimmed.length > 0 ? "\n\n" : ""}${replacementLines.join("\n")}\n`;
  }

  const parentIndex = parentHeaders[0].index;
  if (descendantHeaders.some(({ index }) => index < parentIndex)) {
    throw new Error("Codex config contains an ambiguous semantic_compressor subtree");
  }

  const nextHeaderByIndex = new Map();
  for (let position = 0; position < headers.length; position += 1) {
    nextHeaderByIndex.set(
      headers[position].index,
      position + 1 < headers.length ? headers[position + 1].index : sourceLines.length,
    );
  }

  const targetRanges = new Map(
    targetHeaders.map(({ index }) => [index, nextHeaderByIndex.get(index)]),
  );

  const combined = [];
  for (let index = 0; index < sourceLines.length; ) {
    const targetEnd = targetRanges.get(index);
    if (targetEnd !== undefined) {
      if (index === parentIndex) {
        while (combined.length > 0 && combined.at(-1) === "") combined.pop();
        if (combined.length > 0) combined.push("");
        combined.push(...replacementLines);
        if (targetEnd < sourceLines.length) combined.push("");
      }
      index = targetEnd;
      continue;
    }
    combined.push(sourceLines[index]);
    index += 1;
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
