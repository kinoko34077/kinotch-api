import { ProviderError } from "./provider-error.js";

async function jsonPost(url, headers, body, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(7000),
    });
  } catch {
    throw new ProviderError("network");
  }
  if (!response.ok) throw new ProviderError(response.status === 429 ? "rate_limited" : "upstream_error");
  try { return await response.json(); } catch { throw new ProviderError("invalid_response"); }
}

export function azureProvider({ key, region, fetchImpl = fetch }) {
  return { id: "azure", async translate({ text, source_language, target_language }) {
    if (!key) throw new ProviderError("not_configured");
    const url = new URL("https://api.cognitive.microsofttranslator.com/translate");
    url.searchParams.set("api-version", "3.0");
    url.searchParams.set("to", target_language);
    if (source_language !== "auto") url.searchParams.set("from", source_language);
    const headers = { "Ocp-Apim-Subscription-Key": key };
    if (region) headers["Ocp-Apim-Subscription-Region"] = region;
    const result = await jsonPost(url, headers, [{ Text: text }], fetchImpl);
    const output = result?.[0]?.translations?.[0]?.text;
    if (typeof output !== "string") throw new ProviderError("invalid_response");
    return decodeEntities(output);
  } };
}

function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|#39);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
    if (Object.hasOwn(named, lower)) return named[lower];
    if (lower.startsWith("#")) {
      const hex = lower.startsWith("#x");
      const code = Number.parseInt(lower.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) return String.fromCodePoint(code);
    }
    return match;
  });
}

export function googleProvider({ key, fetchImpl = fetch }) {
  return { id: "google", async translate({ text, source_language, target_language }) {
    if (!key) throw new ProviderError("not_configured");
    const url = new URL("https://translation.googleapis.com/language/translate/v2");
    // Google v2 accepts API key as query parameter; do not log or expose this URL.
    url.searchParams.set("key", key);
    const body = { q: text, target: target_language, format: "text" };
    if (source_language !== "auto") body.source = source_language;
    const result = await jsonPost(url, {}, body, fetchImpl);
    const output = result?.data?.translations?.[0]?.translatedText;
    if (typeof output !== "string") throw new ProviderError("invalid_response");
    return output;
  } };
}
