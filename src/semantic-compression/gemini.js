import {
  COMPRESSION_MODEL,
} from "./contract.js";
import { COMPRESSION_SYSTEM_INSTRUCTION } from "./prompt.js";

export const GEMINI_INTERACTIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";
export const DEFAULT_GEMINI_TIMEOUT_MS = 45_000;

export class CompressionProviderError extends Error {
  constructor(code, status, { retryAfter } = {}) {
    super(code);
    this.name = "CompressionProviderError";
    this.code = code;
    this.status = status;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

function invalidProviderResponse() {
  return new CompressionProviderError("provider_invalid_response", 502);
}

function normalizeRetryAfter(value) {
  if (typeof value !== "string" || !/^\d{1,6}$/.test(value)) return undefined;
  return value;
}

export function extractInteractionText(payload) {
  if (!payload || typeof payload !== "object" || payload.status !== "completed" || !Array.isArray(payload.steps)) {
    throw invalidProviderResponse();
  }

  const finalStep = payload.steps.at(-1);
  if (!finalStep || typeof finalStep !== "object" || finalStep.type !== "model_output" || !Array.isArray(finalStep.content)) {
    throw invalidProviderResponse();
  }

  const parts = [];
  for (const content of finalStep.content) {
    if (content?.type === "text" && typeof content.text === "string") {
      parts.push(content.text);
    }
  }

  const text = parts.join("");
  if (text.trim() === "") throw invalidProviderResponse();
  return text;
}

function timeoutValue(timeoutMs) {
  const value = Number(timeoutMs);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_GEMINI_TIMEOUT_MS;
}

export async function requestGeminiCompression(
  text,
  { apiKey, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_GEMINI_TIMEOUT_MS } = {},
) {
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new CompressionProviderError("provider_unavailable", 503);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutValue(timeoutMs));

  try {
    let response;
    try {
      response = await fetchImpl(GEMINI_INTERACTIONS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          model: COMPRESSION_MODEL,
          input: text,
          system_instruction: COMPRESSION_SYSTEM_INSTRUCTION,
          store: false,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError" || controller.signal.aborted) {
        throw new CompressionProviderError("provider_timeout", 504);
      }
      throw new CompressionProviderError("provider_error", 502);
    }

    if (response?.status === 429) {
      const retryAfter = normalizeRetryAfter(response.headers?.get("Retry-After"));
      throw new CompressionProviderError("provider_rate_limited", 429, { retryAfter });
    }

    if (!response?.ok) {
      throw new CompressionProviderError("provider_error", 502);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw invalidProviderResponse();
    }
    return extractInteractionText(payload);
  } finally {
    clearTimeout(timer);
  }
}
