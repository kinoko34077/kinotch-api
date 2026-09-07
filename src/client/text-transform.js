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
  expectedRuleSetHash,
  maxRetries = 1,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError("timeoutMs must be a non-negative finite number");
  }
  if (expectedRuleSetHash !== undefined && !/^[a-f0-9]{64}$/.test(expectedRuleSetHash)) {
    throw new TypeError("expectedRuleSetHash must be a 64-character lowercase SHA-256 hash");
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3) {
    throw new TypeError("maxRetries must be an integer from 0 to 3");
  }

  const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, "");

  async function request(path, body, fallbackHandler, validatePayload) {
    const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
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
        const requestError = new TextTransformApiError("Text transform API request failed", {
          details: error,
        });
        if (attempt < maxRetries) continue;
        if (typeof fallbackHandler === "function") return fallbackHandler(requestError);
        throw requestError;
      } finally {
        if (timeout) clearTimeout(timeout);
      }

      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        const invalidJsonError = new TextTransformApiError("Text transform API returned invalid JSON", {
          status: response.status,
          details: error,
        });
        if (attempt < maxRetries) continue;
        if (typeof fallbackHandler === "function") return fallbackHandler(invalidJsonError);
        throw invalidJsonError;
      }

      if (!response.ok) {
        const errorPayload = payload && typeof payload === "object" ? payload : {};
        const error = new TextTransformApiError(errorPayload.message || "Text transform API request failed", {
          status: response.status,
          code: errorPayload.error,
          details: errorPayload.details,
        });
        if (retryableStatuses.has(response.status) && attempt < maxRetries) continue;
        if (typeof fallbackHandler === "function" && response.status >= 500) {
          return fallbackHandler(error);
        }
        throw error;
      }

      const responseError = typeof validatePayload === "function"
        ? validatePayload(payload)
        : null;
      if (responseError) {
        const error = new TextTransformApiError(responseError, {
          status: response.status,
          code: "invalid_response",
        });
        if (attempt < maxRetries) continue;
        if (typeof fallbackHandler === "function") return fallbackHandler(error);
        throw error;
      }

      if (expectedRuleSetHash !== undefined && payload?.ruleSetHash !== expectedRuleSetHash) {
        const error = new TextTransformApiError("Text transform API rule set is incompatible", {
          status: 409,
          code: "rule_set_mismatch",
          details: {
            expected: expectedRuleSetHash,
            received: payload?.ruleSetHash,
          },
        });
        if (typeof fallbackHandler === "function") return fallbackHandler(error);
        throw error;
      }

      return payload;
    }

    throw new TextTransformApiError("Text transform API request failed");
  }

  return Object.freeze({
    parseRuby(text, options = {}) {
      return request("/v1/ruby/parse", { text, ...options }, (error) => {
        if (typeof fallback.parseRuby !== "function") throw error;
        return fallback.parseRuby(text, options, error);
      }, (payload) => Array.isArray(payload?.segments)
        ? null
        : "Text transform API returned invalid ruby segments");
    },
    transform(text, options = {}) {
      return request("/v1/transform", { text, ...options }, (error) => {
        if (typeof fallback.transform !== "function") throw error;
        return fallback.transform(text, options, error);
      }, (payload) => typeof payload?.text === "string"
        ? null
        : "Text transform API returned an invalid transformed text");
    },
    transformBatch(texts, options = {}) {
      return request("/v1/transform/batch", { texts, ...options }, (error) => {
        if (typeof fallback.transformBatch !== "function") throw error;
        return fallback.transformBatch(texts, options, error);
      }, (payload) => Array.isArray(payload?.texts) && payload.texts.length === texts.length
        ? null
        : "Text transform API returned an invalid transformed batch");
    },
  });
}
