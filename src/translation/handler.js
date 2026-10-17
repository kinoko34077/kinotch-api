import { translate, validateTranslationRequest } from "./core.js";
import { azureProvider, googleProvider } from "./providers.js";

export async function handleTranslation(c) {
  const expected = c.env?.TRANSLATION_API_TOKEN;
  if (typeof expected !== "string" || expected.length === 0) {
    return c.json({ error: "authentication_unavailable" }, 503);
  }
  const authorization = c.req.header("Authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match) return c.json({ error: "authentication_failed" }, 401);
  const digest = async (text) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  const [actual, desired] = await Promise.all([digest(match[1]), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ desired[i];
  if (diff !== 0) return c.json({ error: "authentication_failed" }, 401);
  let input;
  try {
    input = validateTranslationRequest(await c.req.json());
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const providers = [
    azureProvider({ key: c.env?.AZURE_TRANSLATOR_KEY, region: c.env?.AZURE_TRANSLATOR_REGION }),
    googleProvider({ key: c.env?.GOOGLE_TRANSLATE_API_KEY }),
  ];
  const configured = (id) => id === "azure" ? Boolean(c.env?.AZURE_TRANSLATOR_KEY) : Boolean(c.env?.GOOGLE_TRANSLATE_API_KEY);
  // Explicit opt-in: no accidental third-party data transmission.
  const result = await translate(input, { providers, admit: (id) => c.env?.TRANSLATION_ENABLED === "true" && configured(id) });
  return c.json(result);
}
