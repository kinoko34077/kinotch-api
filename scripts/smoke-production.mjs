import { performance } from "node:perf_hooks";

const API_BASE_URL = (process.env.API_BASE_URL ?? "https://api.kinotch.workers.dev").replace(/\/+$/, "");
const TEXT_DIRECT_URL = (process.env.TEXT_DIRECT_URL ?? "https://text-transform.kinotch.workers.dev").replace(/\/+$/, "");

async function request(path, init = {}, fetchImpl = globalThis.fetch) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(`${API_BASE_URL}${path}`, { ...init, signal: controller.signal });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return {
      status: response.status,
      payload,
      requestId: response.headers.get("X-Request-ID"),
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkDirectTextWorker({ fetchImpl = globalThis.fetch } = {}) {
  const statuses = [];
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let status = null;
    try {
      const response = await fetchImpl(`${TEXT_DIRECT_URL}/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      status = response.status;
    } catch {
      status = null;
    }
    statuses.push(status);
    if (status !== 200) return { status, reachable: false, statuses };
    if (attempt < 2) await wait(2_000);
  }

  return { status: statuses.at(-1), reachable: true, statuses };
}

export function validateCapabilitiesPayload(payload, expectedSourceRevision) {
  if (
    !/^[a-f0-9]{64}$/.test(payload?.ruleSetHash ?? "") ||
    !/^[a-f0-9]{64}$/.test(payload?.snapshotHash ?? "") ||
    !/^[a-f0-9]{64}$/.test(payload?.dictionaryHash ?? "") ||
    payload?.engineVersion !== "0.2.0-phase2" ||
    payload?.metadataVersion !== "snapshot-v1" ||
    payload?.ruleSetVersion !== "rules-v1" ||
    payload?.dictionaryVersion !== "dictionary-v1"
  ) {
    return "capabilities metadata is invalid";
  }
  if (expectedSourceRevision !== undefined && payload?.sourceRevision !== expectedSourceRevision) {
    return `sourceRevision mismatch: expected ${expectedSourceRevision}, received ${payload?.sourceRevision ?? "missing"}`;
  }
  return null;
}

export async function runProductionSmoke({
  checkDirect = false,
  checkGuards = true,
  expectedSourceRevision,
  fetchImpl = globalThis.fetch,
} = {}) {
  const health = await request("/health", {
    headers: { "X-Request-ID": "smoke-health" },
  }, fetchImpl);
  if (health.status !== 200 || health.payload?.status !== "ok") {
    throw new Error(`health smoke failed with status ${health.status}`);
  }

  const capabilities = await request("/v1/capabilities", {
    headers: { "X-Request-ID": "smoke-capabilities" },
  }, fetchImpl);
  const capabilitiesError = capabilities.status === 200
    ? validateCapabilitiesPayload(capabilities.payload, expectedSourceRevision)
    : "capabilities request failed";
  if (capabilitiesError) {
    throw new Error(`capabilities smoke failed with status ${capabilities.status}: ${capabilitiesError}`);
  }

  const preflight = await request("/v1/transform", {
    method: "OPTIONS",
    headers: {
      Origin: "https://smoke.invalid",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type, x-request-id",
    },
  }, fetchImpl);
  if (preflight.status !== 204) {
    throw new Error(`CORS preflight smoke failed with status ${preflight.status}`);
  }

  const batch = await request("/v1/transform/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "smoke-batch",
    },
    body: JSON.stringify({
      texts: ["学校と国", "分かる"],
      profile: ["legacy-kanji"],
    }),
  }, fetchImpl);
  if (batch.status !== 200 || !Array.isArray(batch.payload?.texts) || batch.payload.texts.length !== 2) {
    throw new Error(`batch smoke failed with status ${batch.status}`);
  }

  const invalidProfile = checkGuards
    ? await request("/v1/transform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "学校", profile: ["not-a-profile"] }),
    }, fetchImpl)
    : null;
  if (invalidProfile && (invalidProfile.status !== 400 || invalidProfile.payload?.error !== "invalid_profile")) {
    throw new Error(`invalid profile smoke failed with status ${invalidProfile.status}`);
  }

  const invalidQuery = checkGuards ? await request("/v1/weather?lat=91&lon=139.7", {}, fetchImpl) : null;
  if (invalidQuery && (invalidQuery.status !== 400 || invalidQuery.payload?.error !== "invalid_query")) {
    throw new Error(`query validation smoke failed with status ${invalidQuery.status}`);
  }

  const oversizedBody = checkGuards
    ? await request("/v1/transform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "x".repeat(600_000) }),
    }, fetchImpl)
    : null;
  if (oversizedBody && (oversizedBody.status !== 413 || oversizedBody.payload?.error !== "payload_too_large")) {
    throw new Error(`body limit smoke failed with status ${oversizedBody.status}`);
  }

  if (
    health.requestId !== "smoke-health" ||
    capabilities.requestId !== "smoke-capabilities" ||
    batch.requestId !== "smoke-batch"
  ) {
    throw new Error("request ID propagation smoke failed");
  }

  const directTextWorker = checkDirect ? await checkDirectTextWorker({ fetchImpl }) : null;
  if (directTextWorker?.reachable) {
    throw new Error("text-transform direct workers.dev endpoint is still reachable");
  }

  return {
    baseUrl: API_BASE_URL,
    health: { status: health.status, durationMs: health.durationMs },
    capabilities: {
      status: capabilities.status,
      durationMs: capabilities.durationMs,
      engineVersion: capabilities.payload.engineVersion,
      metadataVersion: capabilities.payload.metadataVersion,
      ruleSetHash: capabilities.payload.ruleSetHash,
      snapshotHash: capabilities.payload.snapshotHash,
      dictionaryVersion: capabilities.payload.dictionaryVersion,
      dictionaryHash: capabilities.payload.dictionaryHash,
      sourceRevision: capabilities.payload.sourceRevision,
    },
    preflight: { status: preflight.status },
    batch: { status: batch.status, durationMs: batch.durationMs, itemCount: batch.payload.texts.length },
    invalidProfile: invalidProfile ? { status: invalidProfile.status } : null,
    invalidQuery: invalidQuery ? { status: invalidQuery.status } : null,
    oversizedBody: oversizedBody ? { status: oversizedBody.status } : null,
    requestIds: {
      health: health.requestId,
      capabilities: capabilities.requestId,
      batch: batch.requestId,
    },
    directTextWorker,
  };
}

if (process.argv[1]?.endsWith("smoke-production.mjs")) {
  const result = await runProductionSmoke({ checkDirect: process.env.CHECK_DIRECT_TEXT_WORKER === "true" });
  console.log(JSON.stringify(result, null, 2));
}
