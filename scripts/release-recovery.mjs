const VERSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertVersionId(versionId, workerName = "Worker") {
  if (typeof versionId !== "string" || !VERSION_ID_PATTERN.test(versionId)) {
    throw new Error(`Invalid ${workerName} version ID: ${versionId ?? "missing"}`);
  }
}

export function parseActiveVersionId(jsonText, workerName = "Worker") {
  let status;
  try {
    status = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Could not parse Wrangler deployment status: ${error.message}`);
  }
  const activeVersions = Array.isArray(status?.versions)
    ? status.versions.filter((version) => Number(version?.percentage) === 100)
    : [];
  if (activeVersions.length !== 1) {
    throw new Error(`Could not identify exactly one 100% active ${workerName} version`);
  }
  const versionId = activeVersions[0]?.version_id;
  assertVersionId(versionId, workerName);
  return versionId;
}

export function createWorkerRollbackArgs(versionId, message, { workerName, config }) {
  assertVersionId(versionId, workerName);
  if (typeof message !== "string" || message.trim() === "") {
    throw new TypeError("rollback message must be a non-empty string");
  }
  if (typeof workerName !== "string" || workerName.trim() === "") {
    throw new TypeError("workerName must be a non-empty string");
  }
  if (typeof config !== "string" || config.trim() === "") {
    throw new TypeError("config must be a non-empty string");
  }
  return [
    "wrangler",
    "rollback",
    versionId,
    "--name",
    workerName,
    "--message",
    message,
    "--config",
    config,
  ];
}

export function createRollbackArgs(versionId, message) {
  return createWorkerRollbackArgs(versionId, message, {
    workerName: "text-transform",
    config: "wrangler.text-transform.jsonc",
  });
}

export async function rollbackAfterSmokeFailure({ previousVersionId, rollback }) {
  assertVersionId(previousVersionId);
  if (typeof rollback !== "function") {
    throw new TypeError("rollback must be a function");
  }
  await rollback(previousVersionId);
  return { status: "rolled_back", targetVersionId: previousVersionId };
}
