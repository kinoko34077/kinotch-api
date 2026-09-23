import {
  COMPRESSION_PROFILE_COMPACT,
  COMPRESSION_PROFILE_SEMANTIC_DENSE,
} from "./contract.js";

// Values are measured with Gemini models.countTokens for the exact fixed prompt.
// Keep the hash beside the measured count so stale token metadata is detectable.
const COMPRESSION_PROMPT_METADATA = Object.freeze({
  [COMPRESSION_PROFILE_COMPACT]: Object.freeze({
    profile: COMPRESSION_PROFILE_COMPACT,
    promptSha256: "f99f547035f87eed62f6b0435d3c0e5b073e336e717cffcd93bad581cf4cbbd4",
    systemPromptTokens: 540,
  }),
  [COMPRESSION_PROFILE_SEMANTIC_DENSE]: Object.freeze({
    profile: COMPRESSION_PROFILE_SEMANTIC_DENSE,
    promptSha256: "5b1610d7fe8225f970cd20a022a2ef666f6c190115eeb82622dcb099e777ef9e",
    systemPromptTokens: 1823,
  }),
});

export function getCompressionPromptMetadata(profile) {
  const metadata = COMPRESSION_PROMPT_METADATA[profile];
  return metadata ? { ...metadata } : null;
}
