import { BENCHMARK_FIXTURES, runRemoteBenchmark } from "./benchmark.js";
import {
  buildHistoryEvent,
  normalizeBenchmarkState,
  readBenchmarkState,
  rollingMean,
  writeBenchmarkState,
  ROLLING_WINDOW,
} from "./history.js";

export async function recordRemoteAudit({
  env,
  report,
  surface,
  elapsedMs,
  benchmarkRunner = runRemoteBenchmark,
  logImpl = console.log,
  fetchImpl = fetch,
  timestamp,
} = {}) {
  let state = normalizeBenchmarkState(null);
  let stateReadError = null;
  try {
    state = await readBenchmarkState(env?.JEV_AUDIT_BENCHMARK_STATE);
  } catch {
    stateReadError = "state_read_error";
  }

  let observation = { fixture_id: null, score: null, error: null };
  let recentScores = [...state.recent_scores];
  let stateWriteError = null;

  if (Number(report?.batches ?? 0) > 0) {
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
