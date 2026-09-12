import { performance } from "node:perf_hooks";
import {
  COMPRESSION_MODEL,
  COMPRESSION_PROFILE,
  COMPRESSION_PROMPT_VERSION,
  countUnicodeCodePoints,
  sha256Hex,
} from "../src/semantic-compression/contract.js";

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
      allowHeaders: response.headers.get("Access-Control-Allow-Headers"),
      exposeHeaders: response.headers.get("Access-Control-Expose-Headers"),
      retryAfter: response.headers.get("Retry-After"),
      rateLimitLimit: response.headers.get("RateLimit-Limit"),
      rateLimitPolicy: response.headers.get("RateLimit-Policy"),
      etag: response.headers.get("ETag"),
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

export function validateClockPayload(payload) {
  return Number.isFinite(Number(payload?.serverTime))
    ? null
    : "time payload has no finite serverTime";
}

export function validateWeatherPayload(payload) {
  return Number.isFinite(Number(payload?.temp)) && typeof payload?.weather === "string" && payload.weather.length > 0
    ? null
    : "weather payload shape is invalid";
}

export function validateRokuyoPayload(payload) {
  return Array.isArray(payload) && typeof payload[0]?.rokuyo === "string" && payload[0].rokuyo.length > 0
    ? null
    : "rokuyo payload shape is invalid";
}

export function validateMoonPayload(payload) {
  return Array.isArray(payload?.result) && Number.isFinite(Number(payload.result[0]?.age))
    ? null
    : "moon payload shape is invalid";
}

export async function validateCompressionPayload(payload, inputText) {
  if (typeof inputText !== "string") return "input text is invalid";
  if (typeof payload?.compressed_text !== "string" || payload.compressed_text.trim() === "") {
    return "compressed_text is missing or empty";
  }
  if (payload.profile !== COMPRESSION_PROFILE) return "compression profile is invalid";
  if (payload.prompt_version !== COMPRESSION_PROMPT_VERSION) return "compression prompt version is invalid";
  if (payload.model !== COMPRESSION_MODEL) return "compression model is invalid";
  if (payload.input_chars !== countUnicodeCodePoints(inputText)) return "input_chars is invalid";
  if (payload.output_chars !== countUnicodeCodePoints(payload.compressed_text)) return "output_chars is invalid";
  if (!/^[a-f0-9]{64}$/.test(payload.input_sha256 ?? "")) return "input_sha256 is invalid";
  if (!/^[a-f0-9]{64}$/.test(payload.output_sha256 ?? "")) return "output_sha256 is invalid";
  if (!Array.isArray(payload.warnings)) return "warnings must be an array";

  const [inputHash, outputHash] = await Promise.all([
    sha256Hex(inputText),
    sha256Hex(payload.compressed_text),
  ]);
  if (payload.input_sha256 !== inputHash) return "input_sha256 does not match input text";
  if (payload.output_sha256 !== outputHash) return "output_sha256 does not match compressed text";
  return null;
}

export async function runCompressionSmoke({
  fetchImpl = globalThis.fetch,
  token,
  path = "/v1/compress",
} = {}) {
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Compression smoke requires COMPRESSION_SMOKE_TOKEN");
  }

  const inputText = "事実: 観測値は10。推測: 原因はZの可能性がある。条件: AならB。";
  const result = await request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Request-ID": "smoke-compression",
    },
    body: JSON.stringify({ text: inputText, profile: COMPRESSION_PROFILE }),
  }, fetchImpl);
  const validationError = result.status === 200
    ? await validateCompressionPayload(result.payload, inputText)
    : "compression request failed";
  if (validationError) {
    throw new Error(`compression smoke failed with status ${result.status}: ${validationError}`);
  }

  return {
    status: result.status,
    durationMs: result.durationMs,
    requestId: result.requestId,
    inputChars: result.payload.input_chars,
    outputChars: result.payload.output_chars,
    model: result.payload.model,
    promptVersion: result.payload.prompt_version,
    inputSha256: result.payload.input_sha256,
    outputSha256: result.payload.output_sha256,
  };
}

export async function runProductionSmoke({
  checkDirect = false,
  checkGuards = true,
  checkCompression = true,
  compressionToken,
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

  const time = await request("/v1/time", {
    headers: { "X-Request-ID": "smoke-time" },
  }, fetchImpl);
  const timeError = time.status === 200 ? validateClockPayload(time.payload) : "time request failed";
  if (timeError) throw new Error(`time smoke failed with status ${time.status}: ${timeError}`);

  const weather = await request("/v1/weather?lat=35.6812&lon=139.7671", {
    headers: { "X-Request-ID": "smoke-weather" },
  }, fetchImpl);
  const weatherError = weather.status === 200 ? validateWeatherPayload(weather.payload) : "weather request failed";
  if (weatherError) throw new Error(`weather smoke failed with status ${weather.status}: ${weatherError}`);

  const rokuyo = await request("/v1/calendar/rokuyo?date=2026-09-09", {
    headers: { "X-Request-ID": "smoke-rokuyo" },
  }, fetchImpl);
  const rokuyoError = rokuyo.status === 200 ? validateRokuyoPayload(rokuyo.payload) : "rokuyo request failed";
  if (rokuyoError) throw new Error(`rokuyo smoke failed with status ${rokuyo.status}: ${rokuyoError}`);

  const moon = await request("/v1/astronomy/moon?lat=35.6812&lon=139.7671", {
    headers: { "X-Request-ID": "smoke-moon" },
  }, fetchImpl);
  const moonError = moon.status === 200 ? validateMoonPayload(moon.payload) : "moon request failed";
  if (moonError) throw new Error(`moon smoke failed with status ${moon.status}: ${moonError}`);

  const preflight = await request("/v1/transform", {
    method: "OPTIONS",
    headers: {
      Origin: "https://smoke.invalid",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type, x-request-id",
    },
  }, fetchImpl);
  if (
    preflight.status !== 204 ||
    !/content-type/i.test(preflight.allowHeaders ?? "") ||
    !/authorization/i.test(preflight.allowHeaders ?? "") ||
    !/x-request-id/i.test(preflight.allowHeaders ?? "")
  ) {
    throw new Error(`CORS preflight smoke failed with status ${preflight.status}`);
  }

  const batch = await request("/v1/transform/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "smoke-batch",
      Origin: "https://smoke.invalid",
    },
    body: JSON.stringify({
      texts: ["学校と国", "分かる"],
      profile: ["legacy-kanji"],
    }),
  }, fetchImpl);
  if (batch.status !== 200 || !Array.isArray(batch.payload?.texts) || batch.payload.texts.length !== 2) {
    throw new Error(`batch smoke failed with status ${batch.status}`);
  }
  const exposedHeaders = batch.exposeHeaders ?? "";
  for (const header of ["X-Request-ID", "Retry-After", "RateLimit-Limit", "RateLimit-Policy", "ETag"]) {
    if (!new RegExp(header, "i").test(exposedHeaders)) {
      throw new Error(`CORS expose-header smoke failed for ${header}`);
    }
  }

  const compression = checkCompression
    ? await runCompressionSmoke({ fetchImpl, token: compressionToken })
    : null;

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
    batch.requestId !== "smoke-batch" ||
    time.requestId !== "smoke-time" ||
    weather.requestId !== "smoke-weather" ||
    rokuyo.requestId !== "smoke-rokuyo" ||
    moon.requestId !== "smoke-moon"
  ) {
    throw new Error("request ID propagation smoke failed");
  }
  if (compression && compression.requestId !== "smoke-compression") {
    throw new Error("compression request ID propagation smoke failed");
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
    services: {
      time: { status: time.status, durationMs: time.durationMs, serverTime: time.payload.serverTime },
      weather: { status: weather.status, durationMs: weather.durationMs, temp: weather.payload.temp, weather: weather.payload.weather },
      rokuyo: { status: rokuyo.status, durationMs: rokuyo.durationMs, rokuyo: rokuyo.payload[0].rokuyo },
      moon: { status: moon.status, durationMs: moon.durationMs, age: moon.payload.result[0].age },
    },
    preflight: { status: preflight.status, allowHeaders: preflight.allowHeaders },
    batch: { status: batch.status, durationMs: batch.durationMs, itemCount: batch.payload.texts.length },
    cors: { exposedHeaders: batch.exposeHeaders },
    invalidProfile: invalidProfile ? { status: invalidProfile.status } : null,
    invalidQuery: invalidQuery ? { status: invalidQuery.status } : null,
    oversizedBody: oversizedBody ? { status: oversizedBody.status } : null,
    compression,
    requestIds: {
      health: health.requestId,
      capabilities: capabilities.requestId,
      batch: batch.requestId,
      time: time.requestId,
      weather: weather.requestId,
      rokuyo: rokuyo.requestId,
      moon: moon.requestId,
    },
    directTextWorker,
  };
}

if (process.argv[1]?.endsWith("smoke-production.mjs")) {
  const result = await runProductionSmoke({
    checkDirect: process.env.CHECK_DIRECT_TEXT_WORKER === "true",
    compressionToken: process.env.COMPRESSION_SMOKE_TOKEN,
  });
  console.log(JSON.stringify(result, null, 2));
}
