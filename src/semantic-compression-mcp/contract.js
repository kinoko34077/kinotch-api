import {
  COMPRESSION_MODEL,
  COMPRESSION_PROMPT_VERSION,
  COMPRESSION_PROFILE_SEMANTIC_DENSE,
  MAX_GEMINI_INPUT_CODE_POINTS,
  countUnicodeCodePoints,
} from "../semantic-compression/contract.js";

export const MCP_TOOL_NAME = "compress_text";
export const MCP_COMPRESSION_PROFILE = COMPRESSION_PROFILE_SEMANTIC_DENSE;
export const MCP_EXPECTED_PROMPT_VERSION = COMPRESSION_PROMPT_VERSION;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateCompressTextInput(value) {
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.text !== "string" || value.text.length === 0) {
    return { ok: false, code: "invalid_input" };
  }
  if (countUnicodeCodePoints(value.text) > MAX_GEMINI_INPUT_CODE_POINTS) {
    return { ok: false, code: "payload_too_large" };
  }
  return { ok: true, text: value.text };
}

export function buildMcpProvenance(value) {
  const warnings = Array.isArray(value?.warnings) ? value.warnings : [];
  return {
    profile: value?.profile === MCP_COMPRESSION_PROFILE ? value.profile : MCP_COMPRESSION_PROFILE,
    prompt_version: typeof value?.prompt_version === "string" ? value.prompt_version : MCP_EXPECTED_PROMPT_VERSION,
    model: typeof value?.model === "string" && value.model.length > 0 ? value.model : COMPRESSION_MODEL,
    input_chars: Number.isSafeInteger(value?.input_chars) && value.input_chars >= 0 ? value.input_chars : null,
    output_chars: Number.isSafeInteger(value?.output_chars) && value.output_chars >= 0 ? value.output_chars : null,
    warnings,
  };
}
