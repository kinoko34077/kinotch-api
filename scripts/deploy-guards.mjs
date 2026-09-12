function hasConfiguredValue(value) {
  if (value === undefined || value === null || value === false || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function assertPrivateWorkerConfig(config, workerName = "worker") {
  if (config?.workers_dev !== false) {
    throw new Error(`${workerName} workers_dev must be false`);
  }
  if (config?.preview_urls !== false) {
    throw new Error(`${workerName} preview_urls must be false`);
  }
  for (const field of ["routes", "route", "domains"]) {
    if (hasConfiguredValue(config?.[field])) {
      throw new Error(`${workerName} ${field} must not be configured for a private Worker`);
    }
  }
  return true;
}

export function assertPrivateTextWorkerConfig(config) {
  return assertPrivateWorkerConfig(config, "text-transform");
}
