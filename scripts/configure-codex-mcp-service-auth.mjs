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
  const matchingIndexes = sourceLines
    .map((line, index) => (line.trim() === SEMANTIC_COMPRESSOR_SECTION ? index : -1))
    .filter((index) => index >= 0);

  if (matchingIndexes.length > 1) {
    throw new Error("Codex config contains multiple semantic_compressor sections");
  }

  const replacementLines = buildSemanticCompressorSection({ helperPath }).split("\n");

  if (matchingIndexes.length === 0) {
    const trimmed = normalizedSource.replace(/\s+$/u, "");
    return `${trimmed}${trimmed.length > 0 ? "\n\n" : ""}${replacementLines.join("\n")}\n`;
  }

  const start = matchingIndexes[0];
  let end = sourceLines.length;
  for (let index = start + 1; index < sourceLines.length; index += 1) {
    const trimmed = sourceLines[index].trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      end = index;
      break;
    }
  }

  const before = sourceLines.slice(0, start);
  const after = sourceLines.slice(end);
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
