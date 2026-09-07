import { Hono } from "hono";
import { cors } from "hono/cors";
import Kuromoji from "./text-core/vendor/kuromoji.js";
import TransformEngine from "./text-core/vendor/transform-engine.js";
import TransformShared from "./text-core/vendor/transform-shared.js";
import { RULE_FILES, RULE_MANIFEST, RULE_SET_HASH } from "./text-core/rules.generated.mjs";

const app = new Hono();
const VERSION = "v1";
const ENGINE_VERSION = "0.2.0-phase2";
const MAX_TEXT_LENGTH = 100_000;
const MAX_BATCH_ITEMS = 256;
const MAX_BATCH_TOTAL_TEXT_LENGTH = 200_000;
const kuromoji = Kuromoji.default ?? Kuromoji;
let tokenizerPromise = null;

app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

const loaded = TransformEngine.loadStagesFromDefinitions(RULE_MANIFEST, RULE_FILES);
const stagesById = new Map(loaded.stages.map((stage) => [stage.id, stage]));

function stageRequiresTokenizer(stage) {
  return stage?.kind === "token-rules" &&
    stage.runtime_mode !== "katakana-long-vowel-abbreviation" &&
    ((Array.isArray(stage.rules) && stage.rules.length > 0) ||
      (typeof stage.runtime_mode === "string" && stage.runtime_mode.trim() !== ""));
}

const supportedProfiles = loaded.stages
  .filter((stage) => !stageRequiresTokenizer(stage))
  .map((stage) => stage.id);
const tokenizerProfiles = loaded.stages
  .filter(stageRequiresTokenizer)
  .map((stage) => stage.id);

function errorResponse(c, status, code, message, details) {
  return c.json({ error: code, message, ...(details ? { details } : {}) }, status);
}

function validateText(value) {
  if (typeof value !== "string") return "text must be a string";
  if (value.length > MAX_TEXT_LENGTH) return `text exceeds ${MAX_TEXT_LENGTH} characters`;
  return null;
}

function validateBatchTexts(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BATCH_ITEMS) {
    return `texts must be a non-empty array with at most ${MAX_BATCH_ITEMS} items`;
  }

  let totalLength = 0;
  for (const text of value) {
    const textError = validateText(text);
    if (textError) return textError;
    totalLength += text.length;
    if (totalLength > MAX_BATCH_TOTAL_TEXT_LENGTH) {
      return `texts exceed ${MAX_BATCH_TOTAL_TEXT_LENGTH} characters in total`;
    }
  }

  return null;
}

function selectStages(profile) {
  const requested = profile === undefined ? ["legacy-kanji"] : profile;
  if (!Array.isArray(requested) || requested.length === 0 || requested.length > 16) {
    return { error: "profile must be a non-empty array with at most 16 entries" };
  }

  const unknown = requested.filter((id) => !stagesById.has(id));
  if (unknown.length > 0) return { error: "unknown transform profile", details: unknown };

  return {
    stages: requested.map((id) => stagesById.get(id)),
    requiresTokenizer: requested.some((id) => tokenizerProfiles.includes(id)),
  };
}

function createFetchXmlHttpRequest(env, baseUrl) {
  return class FetchXmlHttpRequest {
    open(method, url) {
      this.method = method;
      this.url = new URL(url, baseUrl).href;
    }

    send() {
      Promise.resolve().then(async () => {
        const request = new Request(this.url, { method: this.method ?? "GET" });
        const response = env.ASSETS
          ? await env.ASSETS.fetch(request)
          : await fetch(request);
        this.status = response.status;
        this.statusText = response.statusText;
        this.response = await response.arrayBuffer();
        if (response.ok) {
          this.onload?.();
        } else {
          this.onerror?.(new Error(`${response.status} ${response.statusText}`));
        }
      }).catch((error) => this.onerror?.(error));
    }
  };
}

async function buildTokenizer(env, baseUrl) {
  if (!env.ASSETS) {
    throw new Error("Tokenizer assets binding is unavailable");
  }

  const previousXmlHttpRequest = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = createFetchXmlHttpRequest(env, baseUrl);
  try {
    return await new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: "/" }).build((error, tokenizer) => {
        if (error) reject(error);
        else resolve(tokenizer);
      });
    });
  } finally {
    if (previousXmlHttpRequest === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = previousXmlHttpRequest;
  }
}

function getTokenizer(env, baseUrl) {
  if (!tokenizerPromise) {
    tokenizerPromise = buildTokenizer(env, baseUrl).catch((error) => {
      tokenizerPromise = null;
      throw error;
    });
  }
  return tokenizerPromise;
}

async function transformText(c, text, selection) {
  let tokenizer = null;
  if (selection.requiresTokenizer) {
    try {
      tokenizer = await getTokenizer(c.env, c.req.url);
    } catch (error) {
      console.error(error);
      return { error: "tokenizer_unavailable", status: 503 };
    }
  }

  return {
    text: TransformEngine.transformTextWithStages(text, selection.stages, tokenizer),
  };
}

app.get("/health", (c) => c.json({
  status: "ok",
  service: "text-transform",
  version: VERSION,
  engineVersion: ENGINE_VERSION,
}));

app.get("/v1/capabilities", (c) => c.json({
  version: VERSION,
  engineVersion: ENGINE_VERSION,
  ruleSetHash: RULE_SET_HASH,
  profiles: supportedProfiles,
  tokenizerProfiles,
  tokenizerEnabled: true,
  maxTextLength: MAX_TEXT_LENGTH,
  maxBatchItems: MAX_BATCH_ITEMS,
  maxBatchTotalTextLength: MAX_BATCH_TOTAL_TEXT_LENGTH,
}));

app.post("/v1/ruby/parse", async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(c, 400, "invalid_json", "Request body must be valid JSON");
  }

  const textError = validateText(body?.text);
  if (textError) return errorResponse(c, 400, "invalid_text", textError);

  try {
    const markers = body?.markers === undefined
      ? undefined
      : TransformShared.normalizeRubyMarkers(body.markers);
    const segments = TransformShared.parseRenderableRubySegments(body.text, markers);
    return c.json({ segments, engineVersion: ENGINE_VERSION, ruleSetHash: RULE_SET_HASH });
  } catch {
    return errorResponse(c, 400, "invalid_markers", "markers must contain valid open and close strings");
  }
});

app.post("/v1/transform", async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(c, 400, "invalid_json", "Request body must be valid JSON");
  }

  const textError = validateText(body?.text);
  if (textError) return errorResponse(c, 400, "invalid_text", textError);

  const selection = selectStages(body.profile);
  if (selection.error) {
    return errorResponse(c, selection.status ?? 400, "invalid_profile", selection.error, selection.details);
  }

  const transformed = await transformText(c, body.text, selection);
  if (transformed.error) {
    return errorResponse(c, transformed.status, transformed.error, "Tokenizer assets could not be loaded");
  }
  return c.json({
    text: transformed.text,
    profile: selection.stages.map((stage) => stage.id),
    engineVersion: ENGINE_VERSION,
    ruleSetHash: RULE_SET_HASH,
  });
});

app.post("/v1/transform/batch", async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(c, 400, "invalid_json", "Request body must be valid JSON");
  }

  const textsError = validateBatchTexts(body?.texts);
  if (textsError) return errorResponse(c, 400, "invalid_texts", textsError);

  const selection = selectStages(body.profile);
  if (selection.error) {
    return errorResponse(c, selection.status ?? 400, "invalid_profile", selection.error, selection.details);
  }

  const transformed = [];
  for (const text of body.texts) {
    const result = await transformText(c, text, selection);
    if (result.error) {
      return errorResponse(c, result.status, result.error, "Tokenizer assets could not be loaded");
    }
    transformed.push(result.text);
  }

  return c.json({
    texts: transformed,
    profile: selection.stages.map((stage) => stage.id),
    engineVersion: ENGINE_VERSION,
    ruleSetHash: RULE_SET_HASH,
  });
});

app.notFound((c) => errorResponse(c, 404, "not_found", "Not found"));
app.onError((error, c) => {
  console.error(error);
  return errorResponse(c, 500, "worker_error", "Text transformation failed");
});

export default app;
