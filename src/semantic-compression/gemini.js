import {
  COMPRESSION_MODEL,
  COMPRESSION_THINKING_LEVEL,
} from "./contract.js";
import { COMPRESSION_SYSTEM_INSTRUCTION } from "./prompt.js";

export const GEMINI_INTERACTIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";
export const DEFAULT_GEMINI_TIMEOUT_MS = 45_000;

export class CompressionProviderError extends Error {
  constructor(code, status, { retryAfter, diagnostic } = {}) {
    super(code);
    this.name = "CompressionProviderError";
    this.code = code;
    this.status = status;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
    if (diagnostic !== undefined) this.diagnostic = diagnostic;
  }
}

function invalidProviderResponse() {
  return new CompressionProviderError("provider_invalid_response", 502);
}

function normalizeRetryAfter(value) {
  if (typeof value !== "string" || !/^\d{1,6}$/.test(value)) return undefined;
  return value;
}

const MAX_PROVIDER_DIAGNOSTIC_VALUE_LENGTH = 128;

function normalizeDiagnosticValue(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_PROVIDER_DIAGNOSTIC_VALUE_LENGTH) return null;
  return normalized;
}

function firstProviderReason(details) {
  if (!Array.isArray(details)) return null;
  const detail = details.find((value) => value && typeof value === "object" && typeof value.reason === "string");
  return normalizeDiagnosticValue(detail?.reason);
}

function buildProviderDiagnostic({ upstreamStatus, payload }) {
  const providerError = payload?.error;
  const providerStatus = normalizeDiagnosticValue(providerError?.status)
    ?? normalizeDiagnosticValue(providerError?.code);
  const providerReason = normalizeDiagnosticValue(providerError?.reason)
    ?? firstProviderReason(providerError?.details);
  const safeMessage = providerStatus
    ? `Gemini request failed (${providerStatus})`
    : `Gemini request failed with HTTP ${upstreamStatus}`;

  return {
    upstreamStatus,
    providerStatus,
    providerReason,
    safeMessage,
  };
}

function normalizeUsageCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function normalizeInteractionUsage(usage) {
  const source = usage && typeof usage === "object" && !Array.isArray(usage) ? usage : {};
  return {
    inputTokens: normalizeUsageCount(source.total_input_tokens),
    outputTokens: normalizeUsageCount(source.total_output_tokens),
    thoughtTokens: normalizeUsageCount(source.total_thought_tokens),
    cachedTokens: normalizeUsageCount(source.total_cached_tokens),
    totalTokens: normalizeUsageCount(source.total_tokens),
  };
}

async function parseProviderErrorPayload(response) {
  try {
    const payload = await response.json();
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
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
  {
    apiKey,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_GEMINI_TIMEOUT_MS,
    onUsage,
    systemInstruction = COMPRESSION_SYSTEM_INSTRUCTION,
  } = {},
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
          system_instruction: systemInstruction,
          generation_config: { thinking_level: COMPRESSION_THINKING_LEVEL },
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

    if (!response?.ok) {
      const diagnostic = buildProviderDiagnostic({
        upstreamStatus: response?.status,
        payload: await parseProviderErrorPayload(response),
      });
      if (response?.status === 429) {
        const retryAfter = normalizeRetryAfter(response.headers?.get("Retry-After"));
        throw new CompressionProviderError("provider_rate_limited", 429, { retryAfter, diagnostic });
      }
      throw new CompressionProviderError("provider_error", 502, { diagnostic });
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw invalidProviderResponse();
    }
    const compressedText = extractInteractionText(payload);
    const usage = normalizeInteractionUsage(payload.usage);
    if (typeof onUsage === "function") {
      try {
        onUsage(usage);
      } catch {
        // Usage observers are test/evaluation-only and must not affect the response contract.
      }
    }
    return { compressedText, usage };
  } finally {
    clearTimeout(timer);
  }
}
