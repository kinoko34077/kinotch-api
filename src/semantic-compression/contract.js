export const COMPRESSION_PROFILE_COMPACT = "compact-v1";
export const COMPRESSION_PROFILE_SEMANTIC_DENSE = "semantic-dense-v1";
export const COMPRESSION_PROFILES = Object.freeze([
  COMPRESSION_PROFILE_COMPACT,
  COMPRESSION_PROFILE_SEMANTIC_DENSE,
]);

// Backward-compatible aliases for internal evaluation and release tooling.
export const COMPRESSION_PROFILE = COMPRESSION_PROFILE_SEMANTIC_DENSE;
export const COMPRESSION_PROMPT_VERSION = COMPRESSION_PROFILE_SEMANTIC_DENSE;
export const COMPRESSION_MODEL = "gemini-3.5-flash-lite";
export const COMPRESSION_THINKING_LEVEL = "minimal";
export const MAX_COMPRESSION_TEXT_LENGTH = 1_000_000;
export const MAX_GEMINI_INPUT_CODE_POINTS = 200_000;

export function countUnicodeCodePoints(value) {
  return Array.from(value).length;
}

export function isSupportedCompressionProfile(value) {
  return COMPRESSION_PROFILES.includes(value);
}

export async function sha256Hex(value, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle || typeof cryptoImpl.subtle.digest !== "function") {
    throw new Error("Web Crypto SHA-256 is unavailable");
  }

  const bytes = new TextEncoder().encode(value);
  const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildCompressionResponse({
  compressedText,
  inputText,
  profile = COMPRESSION_PROFILE_SEMANTIC_DENSE,
  promptVersion,
  usage,
  warnings = [],
  cryptoImpl = globalThis.crypto,
}) {
  const normalizedUsage = usage && typeof usage === "object" && !Array.isArray(usage) ? usage : {};
  const usageValue = (camelCase, snakeCase) => {
    const value = normalizedUsage[camelCase] ?? normalizedUsage[snakeCase];
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };

  return {
    compressed_text: compressedText,
    profile,
    prompt_version: promptVersion ?? profile,
    model: COMPRESSION_MODEL,
    input_chars: countUnicodeCodePoints(inputText),
    output_chars: countUnicodeCodePoints(compressedText),
    input_sha256: await sha256Hex(inputText, cryptoImpl),
    output_sha256: await sha256Hex(compressedText, cryptoImpl),
    usage: {
      input_tokens: usageValue("inputTokens", "input_tokens"),
      output_tokens: usageValue("outputTokens", "output_tokens"),
      thought_tokens: usageValue("thoughtTokens", "thought_tokens"),
      cached_tokens: usageValue("cachedTokens", "cached_tokens"),
      total_tokens: usageValue("totalTokens", "total_tokens"),
    },
    warnings: Array.isArray(warnings) ? warnings : [],
  };
}
