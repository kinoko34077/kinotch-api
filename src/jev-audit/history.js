import { BENCHMARK_FIXTURES } from "./benchmark.js";

export const BENCHMARK_STATE_KEY = "benchmark-state-v1";
export const BENCHMARK_STATE_SCHEMA_VERSION = 1;
export const ROLLING_WINDOW = 10;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validScore(value) {
  return value === 0 || value === 100 || value === null;
}

export function normalizeBenchmarkState(value) {
  if (!isPlainObject(value)) {
    return { schema_version: BENCHMARK_STATE_SCHEMA_VERSION, next_fixture_index: 0, recent_scores: [] };
  }
  const next = Number.isSafeInteger(value.next_fixture_index) && value.next_fixture_index >= 0
    ? value.next_fixture_index % BENCHMARK_FIXTURES.length
    : 0;
  const scores = Array.isArray(value.recent_scores)
    ? value.recent_scores.filter(validScore).slice(-ROLLING_WINDOW)
    : [];
  return { schema_version: BENCHMARK_STATE_SCHEMA_VERSION, next_fixture_index: next, recent_scores: scores };
}

export function rollingMean(scores) {
  const numeric = scores.filter((value) => value === 0 || value === 100);
  if (numeric.length === 0) return null;
  return numeric.reduce((total, value) => total + value, 0) / numeric.length;
}

export async function readBenchmarkState(binding) {
  if (!binding || typeof binding.get !== "function") throw new Error("benchmark state binding unavailable");
  const raw = await binding.get(BENCHMARK_STATE_KEY, "json");
  return normalizeBenchmarkState(raw);
}

export async function writeBenchmarkState(binding, state) {
  if (!binding || typeof binding.put !== "function") throw new Error("benchmark state binding unavailable");
  const normalized = normalizeBenchmarkState(state);
  await binding.put(BENCHMARK_STATE_KEY, JSON.stringify(normalized));
}

export function buildHistoryEvent(report, {
  surface,
  elapsedMs,
  benchmark,
  timestamp = new Date().toISOString(),
} = {}) {
  const overall = report?.aggregate?.overall ?? {};
  const usage = report?.aggregate?.usage ?? {};
  const provenance = report?.provenance ?? {};
  const scores = Array.isArray(benchmark?.recent_scores)
    ? benchmark.recent_scores.filter(validScore).slice(-ROLLING_WINDOW)
    : [];
  return {
    event: "jev_audit_history",
    schema_version: 1,
    timestamp,
    surface: surface === "rest" || surface === "remote_mcp" ? surface : "unknown",
    profile: String(report?.profile ?? provenance.profile_name ?? "unknown"),
    status: String(overall.status ?? "unknown"),
    risk: Number(overall.risk ?? 0),
    files_scanned: Number(report?.files_scanned ?? 0),
    batches: Number(report?.batches ?? 0),
    elapsed_ms: Number(elapsedMs ?? 0),
    model: String(provenance.resolved_model ?? "unknown"),
    audit_semantics_version: String(provenance.audit_semantics_version ?? "unknown"),
    audit_service_version: String(provenance.service_version ?? "unknown"),
    usage: {
      input_tokens: Number.isInteger(usage.input_tokens) ? usage.input_tokens : null,
      output_tokens: Number.isInteger(usage.output_tokens) ? usage.output_tokens : null,
      input_tokens_complete: Boolean(usage.input_tokens_complete),
      output_tokens_complete: Boolean(usage.output_tokens_complete),
    },
    benchmark: {
      fixture_id: typeof benchmark?.fixture_id === "string" ? benchmark.fixture_id : null,
      score: validScore(benchmark?.score) ? benchmark.score : null,
      error: typeof benchmark?.error === "string" ? benchmark.error : null,
      recent_scores: scores,
      recent_mean: rollingMean(scores),
    },
  };
}
