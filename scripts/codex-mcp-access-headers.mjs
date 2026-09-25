import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  CODEX_MCP_SECRET_KEYS,
  loadProductionSecrets,
} from "./production-secret-mapper.mjs";

const RELEASE_MCP_SECRET_KEYS = Object.freeze([
  "CF_ACCESS_CLIENT_ID",
  "CF_ACCESS_CLIENT_SECRET",
]);

function missingSecretKeys(secrets, keys) {
  return keys.filter(
    (key) => typeof secrets[key] !== "string" || secrets[key].length === 0,
  );
}

export function mapCodexMcpAccessHeaders(secrets) {
  const codexOverridePresent = CODEX_MCP_SECRET_KEYS.some(
    (key) => Object.prototype.hasOwnProperty.call(secrets, key),
  );

  if (codexOverridePresent) {
    const missingKeys = missingSecretKeys(secrets, CODEX_MCP_SECRET_KEYS);
    if (missingKeys.length > 0) {
      throw new Error(`Missing required Codex MCP secret keys:\n${missingKeys.map((key) => `- ${key}`).join("\n")}`);
    }

    return Object.freeze({
      "CF-Access-Client-Id": secrets.CODEX_CF_ACCESS_CLIENT_ID,
      "CF-Access-Client-Secret": secrets.CODEX_CF_ACCESS_CLIENT_SECRET,
    });
  }

  const missingKeys = missingSecretKeys(secrets, RELEASE_MCP_SECRET_KEYS);
  if (missingKeys.length > 0) {
    throw new Error(`Missing required Codex MCP fallback secret keys:\n${missingKeys.map((key) => `- ${key}`).join("\n")}`);
  }

  return Object.freeze({
    "CF-Access-Client-Id": secrets.CF_ACCESS_CLIENT_ID,
    "CF-Access-Client-Secret": secrets.CF_ACCESS_CLIENT_SECRET,
  });
}

export async function main(
  argv = process.argv.slice(2),
  {
    homeDirectory = homedir(),
    loadSecretsImpl = loadProductionSecrets,
    stdout = process.stdout,
    stderr = process.stderr,
  } = {},
) {
  try {
    if (argv.length !== 0) {
      throw new Error("Codex MCP access header helper does not accept arguments");
    }
    const secrets = await loadSecretsImpl({ homeDirectory });
    const headers = mapCodexMcpAccessHeaders(secrets);
    stdout.write(`${JSON.stringify(headers)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : "Codex MCP access header helper failed"}\n`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
