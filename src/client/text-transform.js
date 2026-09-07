export const DEFAULT_TEXT_API_BASE_URL = "https://api.kinotch.workers.dev";

export class TextTransformApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = "TextTransformApiError";
    this.status = status ?? 0;
    this.code = code ?? "request_failed";
    this.details = details;
  }
}

export function createTextTransformClient({
  baseUrl = DEFAULT_TEXT_API_BASE_URL,
  fetchImpl = globalThis.fetch,
  fallback = {},
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }

  const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, "");

  async function request(path, body, fallbackHandler) {
    let response;
    try {
      response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (typeof fallbackHandler === "function") return fallbackHandler(error);
      throw new TextTransformApiError("Text transform API request failed", {
        details: error,
      });
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      if (typeof fallbackHandler === "function") return fallbackHandler();
      throw new TextTransformApiError("Text transform API returned invalid JSON", {
        status: response.status,
      });
    }

    if (!response.ok) {
      const errorPayload = payload && typeof payload === "object" ? payload : {};
      const error = new TextTransformApiError(errorPayload.message || "Text transform API request failed", {
        status: response.status,
        code: errorPayload.error,
        details: errorPayload.details,
      });
      if (typeof fallbackHandler === "function" && response.status >= 500) {
        return fallbackHandler(error);
      }
      throw error;
    }

    return payload;
  }

  return Object.freeze({
    parseRuby(text, options = {}) {
      return request("/v1/ruby/parse", { text, ...options }, (error) => {
        if (typeof fallback.parseRuby !== "function") throw error;
        return fallback.parseRuby(text, options, error);
      });
    },
    transform(text, options = {}) {
      return request("/v1/transform", { text, ...options }, (error) => {
        if (typeof fallback.transform !== "function") throw error;
        return fallback.transform(text, options, error);
      });
    },
  });
}
