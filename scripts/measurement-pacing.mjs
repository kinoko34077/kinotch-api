export const DEFAULT_MEASUREMENT_INTERVAL_MS = 15_000;
const MIN_MEASUREMENT_INTERVAL_MS = 1_000;

export function resolveMeasurementIntervalMs(env, variableName) {
  const rawValue = env[variableName];
  if (rawValue === undefined || rawValue === "") {
    return DEFAULT_MEASUREMENT_INTERVAL_MS;
  }
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${variableName} must be an integer number of milliseconds`);
  }

  const intervalMs = Number(rawValue);
  if (!Number.isSafeInteger(intervalMs) || intervalMs < MIN_MEASUREMENT_INTERVAL_MS) {
    throw new Error(`${variableName} must be at least ${MIN_MEASUREMENT_INTERVAL_MS} milliseconds`);
  }
  return intervalMs;
}

export function getSafeRetryAfterSeconds(response) {
  const retryAfter = response.headers.get("Retry-After");
  return /^\d{1,6}$/.test(retryAfter ?? "") ? Number(retryAfter) : null;
}

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
