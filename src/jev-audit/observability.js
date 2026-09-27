import { BENCHMARK_FIXTURES, runRemoteBenchmark } from "./benchmark.js";
import {
  buildHistoryEvent,
  normalizeBenchmarkState,
  readBenchmarkState,
  rollingMean,
  writeBenchmarkState,
  ROLLING_WINDOW,
} from "./history.js";

function benchmarkSamplingDecision(env, random) {
  const raw = env?.JEV_AUDIT_BENCHMARK_SAMPLE_RATE;
  if (raw === undefined || raw === null || raw === "") return { run: true, error: null };
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) return { run: false, error: "benchmark_config_error" };
  if (rate === 0) return { run: false, error: null };
  if (rate === 1) return { run: true, error: null };
  return { run: random() < rate, error: null };
}

export async function recordRemoteAudit({
  env,
  report,
  surface,
  elapsedMs,
  benchmarkRunner = runRemoteBenchmark,
  logImpl = console.log,
  fetchImpl = fetch,
  timestamp,
  random = Math.random,
} = {}) {
  let state = normalizeBenchmarkState(null);
  let stateReadError = null;
  try {
    state = await readBenchmarkState(env?.JEV_AUDIT_BENCHMARK_STATE);
  } catch {
    stateReadError = "state_read_error";
  }

  const sampling = benchmarkSamplingDecision(env, random);
  let observation = { fixture_id: null, score: null, error: sampling.error };
  let recentScores = [...state.recent_scores];
  let stateWriteError = null;

  if (Number(report?.batches ?? 0) > 0 && sampling.run) {
    try {
      observation = await benchmarkRunner(state.next_fixture_index, {
        apiKey: typeof env?.TYPESAFE_API_KEY === "string" ? env.TYPESAFE_API_KEY.trim() : "",
        fetchImpl,
      });
    } catch {
      observation = {
        fixture_id: BENCHMARK_FIXTURES[state.next_fixture_index].id,
        score: null,
        error: "provider_error",
      };
    }

    recentScores = [...state.recent_scores, observation.score].slice(-ROLLING_WINDOW);
    const nextState = {
      schema_version: 1,
      next_fixture_index: (state.next_fixture_index + 1) % BENCHMARK_FIXTURES.length,
      recent_scores: recentScores,
    };
    try {
      await writeBenchmarkState(env?.JEV_AUDIT_BENCHMARK_STATE, nextState);
    } catch {
      stateWriteError = "state_write_error";
    }
  }

  const benchmark = {
    fixture_id: observation.fixture_id,
    score: observation.score,
    error: observation.error ?? stateReadError ?? stateWriteError,
    recent_scores: recentScores,
    recent_mean: rollingMean(recentScores),
  };
  const event = buildHistoryEvent(report, {
    surface,
    elapsedMs,
    benchmark,
    timestamp,
  });

  try {
    logImpl(event);
  } catch {
    // Logging is observability-only and must never affect the real audit.
  }
  return event;
}
