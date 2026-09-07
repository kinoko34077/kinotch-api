import { Hono } from "hono";
import { cors } from "hono/cors";
import TransformEngine from "./text-core/vendor/transform-engine.js";
import TransformShared from "./text-core/vendor/transform-shared.js";
import { RULE_FILES, RULE_MANIFEST } from "./text-core/rules.generated.mjs";

const app = new Hono();
const VERSION = "v1";
const ENGINE_VERSION = "0.2.0-phase2";
const MAX_TEXT_LENGTH = 100_000;

app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

const loaded = TransformEngine.loadStagesFromDefinitions(RULE_MANIFEST, RULE_FILES);
const stagesById = new Map(loaded.stages.map((stage) => [stage.id, stage]));
const supportedProfiles = loaded.stages
  .filter((stage) => stage.kind === "dictionary-rules")
  .map((stage) => stage.id);
const tokenizerProfiles = loaded.stages
  .filter((stage) => stage.kind === "token-rules")
  .map((stage) => stage.id);

function errorResponse(c, status, code, message, details) {
  return c.json({ error: code, message, ...(details ? { details } : {}) }, status);
}

function validateText(value) {
  if (typeof value !== "string") return "text must be a string";
  if (value.length > MAX_TEXT_LENGTH) return `text exceeds ${MAX_TEXT_LENGTH} characters`;
  return null;
}

function selectStages(profile) {
  const requested = profile === undefined ? ["legacy-kanji"] : profile;
  if (!Array.isArray(requested) || requested.length === 0 || requested.length > 16) {
    return { error: "profile must be a non-empty array with at most 16 entries" };
  }

  const unknown = requested.filter((id) => !stagesById.has(id));
  if (unknown.length > 0) return { error: "unknown transform profile", details: unknown };

  const tokenizerRequired = requested.filter((id) => tokenizerProfiles.includes(id));
  if (tokenizerRequired.length > 0) {
    return {
      error: "profile requires tokenizer support not enabled in this Worker",
      details: tokenizerRequired,
      status: 501,
    };
  }

  return { stages: requested.map((id) => stagesById.get(id)) };
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
  profiles: supportedProfiles,
  tokenizerProfiles,
  tokenizerEnabled: false,
  maxTextLength: MAX_TEXT_LENGTH,
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

  const markers = body?.markers === undefined
    ? undefined
    : TransformShared.normalizeRubyMarkers(body.markers);
  const segments = TransformShared.parseRenderableRubySegments(body.text, markers);
  return c.json({ segments, engineVersion: ENGINE_VERSION });
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

  const text = TransformEngine.transformTextWithStages(body.text, selection.stages, null);
  return c.json({
    text,
    profile: selection.stages.map((stage) => stage.id),
    engineVersion: ENGINE_VERSION,
  });
});

app.notFound((c) => errorResponse(c, 404, "not_found", "Not found"));
app.onError((error, c) => {
  console.error(error);
  return errorResponse(c, 500, "worker_error", "Text transformation failed");
});

export default app;
