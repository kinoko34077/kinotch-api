import {
  COMPRESSION_PROFILE_COMPACT,
  COMPRESSION_PROFILE_SEMANTIC_DENSE,
} from "./contract.js";

// Values are measured with Gemini models.countTokens for the exact fixed prompt.
// Keep the hash beside the measured count so stale token metadata is detectable.
const COMPRESSION_PROMPT_METADATA = Object.freeze({
  [COMPRESSION_PROFILE_COMPACT]: Object.freeze({
    profile: COMPRESSION_PROFILE_COMPACT,
    promptSha256: "8eb825cae866c64c1850134bbbde131704b83374e9c0e9a5f1fea86cf66b1c1b",
    systemPromptTokens: 266,
  }),
  [COMPRESSION_PROFILE_SEMANTIC_DENSE]: Object.freeze({
    profile: COMPRESSION_PROFILE_SEMANTIC_DENSE,
    promptSha256: "9918e2a299d58fa7624f92e3b597493414a77948d55e8578a41ca1ac5920917e",
    systemPromptTokens: 1549,
  }),
});

export function getCompressionPromptMetadata(profile) {
  const metadata = COMPRESSION_PROMPT_METADATA[profile];
  return metadata ? { ...metadata } : null;
}
