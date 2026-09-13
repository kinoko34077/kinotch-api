import { Hono } from "hono";
import { requestIdMiddleware } from "./middleware/request-id.js";
import {
  buildCompressionResponse,
  COMPRESSION_MODEL,
  countUnicodeCodePoints,
  isSupportedCompressionProfile,
  MAX_GEMINI_INPUT_CODE_POINTS,
  MAX_COMPRESSION_TEXT_LENGTH,
} from "./semantic-compression/contract.js";
import {
  CompressionProviderError,
  requestGeminiCompression,
} from "./semantic-compression/gemini.js";
import { resolveCompressionProfile } from "./semantic-compression/prompt.js";

const SERVICE_VERSION = "v1";
const ALLOWED_REQUEST_FIELDS = new Set(["text", "profile"]);

function errorResponse(c, status, code, message) {
  return c.json({
    error: code,
    message,
    ...(c.get("requestId") ? { requestId: c.get("requestId") } : {}),
  }, status);
}

function isRequestObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateCompressionBody(body) {
  if (!isRequestObject(body)) return { status: 400, code: "invalid_body", message: "Request body must be an object" };

  const unknownField = Object.keys(body).find((key) => !ALLOWED_REQUEST_FIELDS.has(key));
  if (unknownField) {
    return { status: 400, code: "invalid_body", message: "Request body contains unsupported fields" };
  }
  if (typeof body.text !== "string") {
    return { status: 400, code: "invalid_body", message: "text must be a string" };
  }
  if (body.text.length === 0) {
    return { status: 400, code: "empty_text", message: "text must not be empty" };
  }
  if (!isSupportedCompressionProfile(body.profile)) {
    return { status: 400, code: "invalid_profile", message: "profile is not supported" };
  }

  const textChars = countUnicodeCodePoints(body.text);
  if (textChars > MAX_COMPRESSION_TEXT_LENGTH) {
    return { status: 413, code: "payload_too_large", message: "text exceeds the maximum length" };
  }
  if (textChars > MAX_GEMINI_INPUT_CODE_POINTS) {
    return { status: 413, code: "provider_context_limit", message: "text exceeds the provider context safety limit" };
  }
  return null;
}

function logSafeMetrics(c, status, inputChars, outputChars, startedAt) {
  if (c.env?.ENABLE_REQUEST_LOGS !== "true") return;
  const ratio = inputChars > 0 && outputChars !== undefined
    ? Number((outputChars / inputChars).toFixed(6))
    : null;
  console.log(JSON.stringify({
    event: "compression_request",
    requestId: c.get("requestId") ?? null,
    route: c.req.path,
    status,
    elapsedMs: Date.now() - startedAt,
    inputChars: inputChars ?? null,
    outputChars: outputChars ?? null,
    model: COMPRESSION_MODEL,
    promptVersion: c.get("compressionPromptVersion") ?? null,
    errorCategory: c.get("errorCategory") ?? null,
    compressionRatio: ratio,
  }));
}

export function createCompressionWorkerApp({
  fetchImpl = globalThis.fetch,
  onProviderDiagnostic,
  onUsage,
  systemInstruction = null,
} = {}) {
  const app = new Hono();

  app.use("*", requestIdMiddleware());

  app.get("/health", (c) => c.json({
    status: "ok",
    service: "semantic-compression",
    version: SERVICE_VERSION,
  }));

  app.post("/v1/compress", async (c) => {
    const startedAt = Date.now();
    let inputChars;
    let outputChars;
    let status = 500;
    try {
      const contentType = c.req.header("Content-Type")?.toLowerCase() ?? "";
      if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType.trim())) {
        status = 400;
        c.set("errorCategory", "invalid_body");
        return errorResponse(c, status, "invalid_body", "Content-Type must be application/json");
      }

      let body;
      try {
        body = await c.req.json();
      } catch {
        status = 400;
        c.set("errorCategory", "invalid_json");
        return errorResponse(c, status, "invalid_json", "Request body must be valid JSON");
      }

      const validationError = validateCompressionBody(body);
      if (validationError) {
        status = validationError.status;
        c.set("errorCategory", validationError.code);
        return errorResponse(c, status, validationError.code, validationError.message);
      }

      const profileConfig = resolveCompressionProfile(body.profile);
      if (!profileConfig) {
        status = 400;
        c.set("errorCategory", "invalid_profile");
        return errorResponse(c, status, "invalid_profile", "profile is not supported");
      }
      c.set("compressionPromptVersion", profileConfig.promptVersion);
      inputChars = countUnicodeCodePoints(body.text);
      const result = await requestGeminiCompression(body.text, {
        apiKey: c.env?.GEMINI_API_KEY,
        fetchImpl,
        timeoutMs: c.env?.GEMINI_TIMEOUT_MS,
        onUsage,
        systemInstruction: systemInstruction ?? profileConfig.systemInstruction,
      });
      const { compressedText, usage } = result;
      outputChars = countUnicodeCodePoints(compressedText);
      const response = await buildCompressionResponse({
        compressedText,
        inputText: body.text,
        profile: profileConfig.profile,
        promptVersion: profileConfig.promptVersion,
        usage,
        warnings: [],
      });
      status = 200;
      return c.json(response, status);
    } catch (error) {
      if (error instanceof CompressionProviderError) {
        if (error.diagnostic && typeof onProviderDiagnostic === "function") {
          try {
            onProviderDiagnostic(error.diagnostic);
          } catch {
            // Diagnostic observers are test-only and must not affect the response contract.
          }
        }
        status = error.status;
        c.set("errorCategory", error.code);
        if (error.retryAfter !== undefined) c.header("Retry-After", error.retryAfter);
        if (status >= 500) {
          console.error(JSON.stringify({
            event: "compression_provider_error",
            requestId: c.get("requestId") ?? null,
            code: error.code,
            status,
          }));
        }
        return errorResponse(c, status, error.code, "Compression provider request failed");
      }

      status = 500;
      c.set("errorCategory", "internal_error");
      console.error(JSON.stringify({
        event: "compression_internal_error",
        requestId: c.get("requestId") ?? null,
        status,
      }));
      return errorResponse(c, status, "internal_error", "Compression request failed");
    } finally {
      logSafeMetrics(c, status, inputChars, outputChars, startedAt);
    }
  });

  return app;
}

const app = createCompressionWorkerApp();

export default app;
