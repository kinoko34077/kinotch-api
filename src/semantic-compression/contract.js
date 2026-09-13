export const COMPRESSION_PROFILE = "semantic-dense-v1";
export const COMPRESSION_PROMPT_VERSION = "semantic-dense-v1";
export const COMPRESSION_MODEL = "gemini-2.5-flash-lite";
export const MAX_COMPRESSION_TEXT_LENGTH = 1_000_000;
export const MAX_GEMINI_INPUT_CODE_POINTS = 200_000;

export function countUnicodeCodePoints(value) {
  return Array.from(value).length;
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
  warnings = [],
  cryptoImpl = globalThis.crypto,
}) {
  return {
    compressed_text: compressedText,
    profile: COMPRESSION_PROFILE,
    prompt_version: COMPRESSION_PROMPT_VERSION,
    model: COMPRESSION_MODEL,
    input_chars: countUnicodeCodePoints(inputText),
    output_chars: countUnicodeCodePoints(compressedText),
    input_sha256: await sha256Hex(inputText, cryptoImpl),
    output_sha256: await sha256Hex(compressedText, cryptoImpl),
    warnings: Array.isArray(warnings) ? warnings : [],
  };
}
