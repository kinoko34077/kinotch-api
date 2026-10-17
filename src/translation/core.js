export const TRANSLATION_POLICY_VERSION = "v1";

export function validateTranslationRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("invalid_request");
  const { text, source_language = "auto", target_language = "ja", profile = "technical" } = value;
  if (typeof text !== "string" || text.length < 1 || text.length > 10000) throw new TypeError("invalid_text");
  if (!["auto", "en", "ja"].includes(source_language)) throw new TypeError("invalid_source_language");
  if (!["en", "ja"].includes(target_language)) throw new TypeError("invalid_target_language");
  if (profile !== "technical") throw new TypeError("invalid_profile");
  return { text, source_language, target_language, profile };
}

export async function translate(input, { providers = [], admit = () => false } = {}) {
  const request = validateTranslationRequest(input);
  const original = { original: request.text, translated: null, status: "original", provider: null, policy_version: TRANSLATION_POLICY_VERSION };
  for (const provider of providers) {
    if (!["azure", "google"].includes(provider?.id)) continue;
    // Caller must enforce durable, free-only quota accounting before enabling calls.
    if (!(await admit(provider.id, request.text.length))) continue;
    try {
      const translated = await provider.translate(request);
      if (typeof translated === "string" && translated.trim()) {
        return { ...original, translated, status: "translated", provider: provider.id };
      }
    } catch {
      // Translation is display-only; retain the original on failure.
    }
  }
  return original;
}
