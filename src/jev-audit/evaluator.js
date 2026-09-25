import {
  AUDIT_SEMANTICS_VERSION,
  AUDIT_SERVICE_VERSION,
  DEFAULT_JEV_MODEL,
  REMOTE_AUDIT_LIMITS,
  buildQuestionPayload,
  countUnicodeCodePoints,
  estimateQuestionOverhead,
  normalizeAuditFiles,
  validateAuditInput,
} from "./contract.js";

const SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone";
const STATUS_KEYS = new Set(["clear", "review", "rework", "unknown"]);
const RISK_SIGNALS = ["concrete_issue", "spec_mismatch", "regression_risk"];
const REQUIRED_ANSWERS = new Set(["local_status", ...RISK_SIGNALS]);

export class AuditRemoteError extends Error {
  constructor(code, status, message = code) {
    super(message);
    this.name = "AuditRemoteError";
    this.code = code;
    this.status = status;
  }
}

function finiteProbability(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new AuditRemoteError("provider_response_invalid", 502, `${label} must be a finite probability`);
  }
  return value;
}

function tokenCount(value, label) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new AuditRemoteError("provider_response_invalid", 502, `${label} must be a non-negative integer`);
  }
  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fileCost(file) {
  return countUnicodeCodePoints(file.content)
    + countUnicodeCodePoints(file.change ?? "")
    + countUnicodeCodePoints(file.path)
    + 32;
}

export function makeAuditBatches(files) {
  const batches = [];
  let current = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length === 0) return;
    batches.push({ index: batches.length + 1, files: current });
    current = [];
    currentChars = 0;
  };

  for (const file of files) {
    const cost = fileCost(file);
    if (cost > REMOTE_AUDIT_LIMITS.batchChars) {
      throw new AuditRemoteError(
        "audit_batch_too_large",
        413,
        `file ${file.path} exceeds the remote batch character limit`,
      );
    }
    if (current.length > 0 && currentChars + cost > REMOTE_AUDIT_LIMITS.batchChars) flush();
    current.push(file);
    currentChars += cost;
    if (currentChars >= REMOTE_AUDIT_LIMITS.batchChars) flush();
  }
  flush();

  if (batches.length > REMOTE_AUDIT_LIMITS.maxBatches) {
    throw new AuditRemoteError(
      "audit_too_many_batches",
      413,
      `audit requires more than ${REMOTE_AUDIT_LIMITS.maxBatches} batches`,
    );
  }
  return batches;
}

export function validateSystemOneResponse(payload) {
  if (!isPlainObject(payload) || typeof payload.model !== "string" || payload.model.trim() !== DEFAULT_JEV_MODEL) {
    throw new AuditRemoteError("provider_response_invalid", 502, "provider response model does not match the pinned model");
  }
  if (!isPlainObject(payload.answers) ||
      payload.answers === null ||
      new Set(Object.keys(payload.answers)).size !== REQUIRED_ANSWERS.size ||
      Object.keys(payload.answers).some((key) => !REQUIRED_ANSWERS.has(key))) {
    throw new AuditRemoteError("provider_response_invalid", 502, "provider response answer set is invalid");
  }
  for (const required of REQUIRED_ANSWERS) {
    if (!Object.hasOwn(payload.answers, required)) {
      throw new AuditRemoteError("provider_response_invalid", 502, "provider response is missing a required answer");
    }
  }

  const local = payload.answers.local_status;
  if (!isPlainObject(local) || local.type !== "choice" || !isPlainObject(local.probabilities)) {
    throw new AuditRemoteError("provider_response_invalid", 502, "local_status answer is invalid");
  }
  if (typeof local.choice !== "string" || !STATUS_KEYS.has(local.choice)) {
    throw new AuditRemoteError("provider_response_invalid", 502, "local_status choice is invalid");
  }
  const probabilityKeys = Object.keys(local.probabilities);
  if (probabilityKeys.length !== STATUS_KEYS.size || probabilityKeys.some((key) => !STATUS_KEYS.has(key))) {
    throw new AuditRemoteError("provider_response_invalid", 502, "local_status probability keys are invalid");
  }
  const probabilities = {};
  for (const key of STATUS_KEYS) {
    probabilities[key] = finiteProbability(local.probabilities[key], `local_status.${key}`);
  }
  const sum = Object.values(probabilities).reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) > 1e-6) {
    throw new AuditRemoteError("provider_response_invalid", 502, "local_status probabilities must sum to 1");
  }
  const confidence = finiteProbability(local.confidence, "local_status.confidence");

  const nouls = {};
  for (const name of RISK_SIGNALS) {
    const answer = payload.answers[name];
    if (!isPlainObject(answer) || answer.type !== "noul") {
      throw new AuditRemoteError("provider_response_invalid", 502, `${name} answer is invalid`);
    }
    nouls[name] = finiteProbability(answer.noul, `${name}.noul`);
  }

  const usage = payload.usage === undefined || payload.usage === null
    ? { input_tokens: null, output_tokens: null }
    : (() => {
        if (!isPlainObject(payload.usage)) {
          throw new AuditRemoteError("provider_response_invalid", 502, "provider usage is invalid");
        }
        return {
          input_tokens: tokenCount(payload.usage.input_tokens, "input_tokens"),
          output_tokens: tokenCount(payload.usage.output_tokens, "output_tokens"),
        };
      })();

  return {
    model: DEFAULT_JEV_MODEL,
    usage,
    choices: {
      local_status: {
        choice: local.choice,
        confidence,
        probabilities,
      },
    },
    nouls,
  };
}

function stats(values) {
  if (values.length === 0) return { max: 0, mean: 0 };
  return {
    max: Math.max(...values),
    mean: values.reduce((total, value) => total + value, 0) / values.length,
  };
}

function riskDetails(batchAudit) {
  let driver = RISK_SIGNALS[0];
  let risk = Number(batchAudit.result.nouls[driver] ?? 0);
  for (const name of RISK_SIGNALS.slice(1)) {
    const value = Number(batchAudit.result.nouls[name] ?? 0);
    if (value > risk) {
      driver = name;
      risk = value;
    }
  }
  return { risk, driver };
}

function overallStatus(ranked) {
  if (ranked.length === 0) return { status: "unknown", trigger: null };

  const red = ranked.filter((item) => item.concrete_issue >= 0.80 && item.rework_probability >= 0.60);
  if (red.length > 0) {
    red.sort((a, b) => (b.concrete_issue - a.concrete_issue) || (b.rework_probability - a.rework_probability));
    const item = red[0];
    return {
      status: "rework",
      trigger: {
        kind: "concrete_and_rework",
        batch_index: item.index,
        paths: item.paths,
        concrete_issue: item.concrete_issue,
        rework_probability: item.rework_probability,
      },
    };
  }

  const highestRisk = ranked[0];
  if (highestRisk.risk >= 0.55) {
    return {
      status: "review",
      trigger: {
        kind: "concrete_risk",
        batch_index: highestRisk.index,
        paths: highestRisk.paths,
        value: highestRisk.risk,
        risk_driver: highestRisk.risk_driver,
      },
    };
  }

  const actionable = [...ranked].sort((a, b) => b.actionable_probability - a.actionable_probability)[0];
  if (actionable.actionable_probability >= 0.60) {
    return {
      status: "review",
      trigger: {
        kind: "actionable_probability",
        batch_index: actionable.index,
        paths: actionable.paths,
        value: actionable.actionable_probability,
      },
    };
  }

  const unknown = [...ranked].sort((a, b) => b.unknown_probability - a.unknown_probability)[0];
  if (unknown.unknown_probability >= 0.80) {
    return {
      status: "unknown",
      trigger: {
        kind: "unknown_probability",
        batch_index: unknown.index,
        paths: unknown.paths,
        value: unknown.unknown_probability,
      },
    };
  }

  return { status: "clear", trigger: null };
}

export function aggregateAuditBatches(batchAudits) {
  const signalValues = Object.fromEntries(RISK_SIGNALS.map((name) => [name, []]));
  let totalInput = 0;
  let totalOutput = 0;
  let inputMissing = 0;
  let outputMissing = 0;
  let totalLatency = 0;
  const ranked = [];

  for (const batch of batchAudits) {
    const result = batch.result;
    totalLatency += Number(result.elapsed_ms ?? 0);
    if (Number.isInteger(result.usage.input_tokens)) totalInput += result.usage.input_tokens;
    else inputMissing += 1;
    if (Number.isInteger(result.usage.output_tokens)) totalOutput += result.usage.output_tokens;
    else outputMissing += 1;

    for (const name of RISK_SIGNALS) signalValues[name].push(Number(result.nouls[name] ?? 0));
    const { risk, driver } = riskDetails(batch);
    const probs = result.choices.local_status.probabilities;
    const reviewProbability = Number(probs.review ?? 0);
    const reworkProbability = Number(probs.rework ?? 0);
    const unknownProbability = Number(probs.unknown ?? 0);
    ranked.push({
      index: batch.index,
      risk,
      risk_driver: driver,
      concrete_issue: Number(result.nouls.concrete_issue ?? 0),
      review_probability: reviewProbability,
      rework_probability: reworkProbability,
      actionable_probability: Math.max(0, Math.min(1, reviewProbability + reworkProbability)),
      unknown_probability: unknownProbability,
      paths: [...batch.paths],
    });
  }

  ranked.sort((a, b) => b.risk - a.risk);
  const { status, trigger } = overallStatus(ranked);
  const count = batchAudits.length;
  return {
    batch_count: count,
    overall: {
      status,
      risk: ranked.length > 0 ? ranked[0].risk : 0,
      status_trigger: trigger,
    },
    signals: Object.fromEntries(RISK_SIGNALS.map((name) => [name, stats(signalValues[name])])),
    usage: {
      input_tokens: count > 0 && inputMissing === count ? null : totalInput,
      output_tokens: count > 0 && outputMissing === count ? null : totalOutput,
      input_tokens_complete: inputMissing === 0,
      output_tokens_complete: outputMissing === 0,
      input_tokens_missing_batches: inputMissing,
      output_tokens_missing_batches: outputMissing,
    },
    total_batch_latency_ms: totalLatency,
    highest_risk_batches: ranked.slice(0, 10),
  };
}

function mapProviderStatus(status) {
  if (status === 400) return ["provider_bad_request", 502];
  if (status === 401) return ["provider_authentication", 502];
  if (status === 403) return ["provider_permission_denied", 502];
  if (status === 404) return ["provider_not_found", 502];
  if (status === 422) return ["provider_unprocessable", 502];
  if (status === 429) return ["provider_rate_limit", 503];
  if (status >= 500) return ["provider_internal", 502];
  return ["provider_error", 502];
}

async function callSystemOne({ apiKey, state, questions, fetchImpl, timeoutMs }) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const started = performance.now();
  let response;
  try {
    response = await fetchImpl(SYSTEM_ONE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ state, questions, model: DEFAULT_JEV_MODEL }),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new AuditRemoteError("provider_timeout", 504, "TypeSafe request timed out");
    }
    throw new AuditRemoteError("provider_connection", 502, "TypeSafe request failed");
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response.ok) {
    const [code, status] = mapProviderStatus(response.status);
    throw new AuditRemoteError(code, status, `TypeSafe request failed with status ${response.status}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new AuditRemoteError("provider_response_invalid", 502, "TypeSafe response is not valid JSON");
  }
  return {
    ...validateSystemOneResponse(payload),
    elapsed_ms: performance.now() - started,
  };
}

async function mapConcurrent(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function evaluateAudit(env, body, options = {}) {
  const validation = validateAuditInput(body);
  if (!validation.ok) {
    throw new AuditRemoteError(validation.code, validation.status, validation.message);
  }
  const apiKey = typeof env?.TYPESAFE_API_KEY === "string" ? env.TYPESAFE_API_KEY.trim() : "";
  if (!apiKey) {
    throw new AuditRemoteError("provider_authentication_unavailable", 503, "TypeSafe API key is unavailable");
  }

  const normalized = normalizeAuditFiles(body.files);
  const batches = makeAuditBatches(normalized.files);
  const questions = buildQuestionPayload(validation.profile);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.providerTimeoutMs ?? REMOTE_AUDIT_LIMITS.providerTimeoutMs;

  const batchAudits = await mapConcurrent(
    batches,
    REMOTE_AUDIT_LIMITS.maxConcurrency,
    async (batch) => {
      const state = {
        files: batch.files.map((file) => ({
          path: file.path,
          truncated: file.truncated,
          content: file.content,
          change: file.change,
        })),
      };
      const result = await callSystemOne({ apiKey, state, questions, fetchImpl, timeoutMs });
      return {
        index: batch.index,
        paths: batch.files.map((file) => file.path),
        result,
      };
    },
  );

  const models = new Set(batchAudits.map((item) => item.result.model));
  if (models.size !== 1) {
    throw new AuditRemoteError("provider_response_invalid", 502, "TypeSafe returned inconsistent models across batches");
  }

  const aggregate = aggregateAuditBatches(batchAudits);
  const estimatedStateChars = normalized.files.reduce((total, file) => total + fileCost(file), 0);
  const estimatedTotalInputChars = estimatedStateChars + estimateQuestionOverhead(validation.profile) * batches.length;

  return {
    profile: validation.profile,
    files_scanned: normalized.files.length,
    batches: batches.length,
    aggregate,
    truncated_paths: normalized.truncatedPaths,
    coverage: {
      submitted_files: body.files.length,
      audited_files: normalized.files.length,
      truncated_files: normalized.truncatedPaths.length,
    },
    provenance: {
      service_version: AUDIT_SERVICE_VERSION,
      audit_semantics_version: AUDIT_SEMANTICS_VERSION,
      resolved_model: batchAudits[0]?.result.model ?? DEFAULT_JEV_MODEL,
      profile_name: validation.profile,
      batch_count: batches.length,
      estimated_total_input_chars: estimatedTotalInputChars,
    },
  };
}
