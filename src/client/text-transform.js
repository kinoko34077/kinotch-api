export const DEFAULT_TEXT_API_BASE_URL = "https://api.kinotch.workers.dev";
export const DEFAULT_TEXT_API_TIMEOUT_MS = 8_000;

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
  timeoutMs = DEFAULT_TEXT_API_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError("timeoutMs must be a non-negative finite number");
  }

  const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, "");

  async function request(path, body, fallbackHandler) {
    let response;
    const controller = typeof AbortController === "function"
      ? new AbortController()
      : null;
    const timeout = controller && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      const requestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      };
      if (controller) requestInit.signal = controller.signal;
      response = await fetchImpl(`${normalizedBaseUrl}${path}`, requestInit);
    } catch (error) {
      if (typeof fallbackHandler === "function") return fallbackHandler(error);
      throw new TextTransformApiError("Text transform API request failed", {
        details: error,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
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
    transformBatch(texts, options = {}) {
      return request("/v1/transform/batch", { texts, ...options }, (error) => {
        if (typeof fallback.transformBatch !== "function") throw error;
        return fallback.transformBatch(texts, options, error);
      });
    },
  });
}
