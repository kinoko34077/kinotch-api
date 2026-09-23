import {
  MCP_COMPRESSION_PROFILE,
  MCP_EXPECTED_PROMPT_VERSION,
} from "./contract.js";
import { countUnicodeCodePoints } from "../semantic-compression/contract.js";

export class CompressionMcpError extends Error {
  constructor(code, status = 500) {
    super(code);
    this.name = "CompressionMcpError";
    this.code = code;
    this.status = status;
  }
}

function isSafeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isValidPayload(value, inputText) {
  const compressedText = typeof value?.compressed_text === "string" ? value.compressed_text : null;
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && compressedText !== null
    && compressedText.length > 0
    && value.profile === MCP_COMPRESSION_PROFILE
    && value.prompt_version === MCP_EXPECTED_PROMPT_VERSION
    && typeof value.model === "string"
    && value.model.length > 0
    && isSafeCount(value.input_chars)
    && isSafeCount(value.output_chars)
    && value.input_chars === countUnicodeCodePoints(inputText)
    && value.output_chars === countUnicodeCodePoints(compressedText)
    && Array.isArray(value.warnings);
}

function mapStatus(status) {
  if (status === 413) return new CompressionMcpError("payload_too_large", 413);
  if (status === 429) return new CompressionMcpError("rate_limited", 429);
  if (status === 400) return new CompressionMcpError("invalid_input", 400);
  if (status >= 500) return new CompressionMcpError("compression_unavailable", 502);
  return new CompressionMcpError("invalid_upstream_response", 502);
}

export async function callCompressionService(env, text, {
  timeoutMs = 50_000,
} = {}) {
  const service = env?.COMPRESSION;
  if (!service || typeof service.fetch !== "function") {
    throw new CompressionMcpError("compression_unavailable", 503);
  }

  const controller = typeof AbortController === "function" && timeoutMs > 0
    ? new AbortController()
    : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await service.fetch(new Request("https://semantic-compression.internal/v1/compress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, profile: MCP_COMPRESSION_PROFILE }),
      ...(controller ? { signal: controller.signal } : {}),
    }));
    if (response.status !== 200) throw mapStatus(response.status);

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new CompressionMcpError("invalid_upstream_response", 502);
    }
    if (!isValidPayload(payload, text)) throw new CompressionMcpError("invalid_upstream_response", 502);
    return payload;
  } catch (error) {
    if (error instanceof CompressionMcpError) throw error;
    if (error?.name === "AbortError") throw new CompressionMcpError("compression_timeout", 504);
    throw new CompressionMcpError("compression_unavailable", 502);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
