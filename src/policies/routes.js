import { REMOTE_AUDIT_LIMITS } from "../jev-audit/contract.js";
import {
  validateBatchBody,
  validateCoordinatesQuery,
  validateDateQuery,
  validateCompressionBody,
  validateJevAuditBody,
  validateRubyBody,
  validateTransformBody,
} from "../middleware/validation.js";
import { authenticateCompression, authenticateJevAudit } from "../middleware/authentication.js";
import { COMPRESSION_BODY_LIMIT_BYTES } from "../semantic-compression/contract.js";

const GENERAL_RATE_LIMIT = Object.freeze({
  binding: "GENERAL_RATE_LIMITER",
  limit: 60,
  period: 60,
});
const TEXT_RATE_LIMIT = Object.freeze({
  binding: "TEXT_RATE_LIMITER",
  limit: 30,
  period: 60,
});
const COMPRESSION_PREAUTH_RATE_LIMIT = Object.freeze({
  binding: "COMPRESSION_PREAUTH_RATE_LIMITER",
  keyPrefix: "semantic-compression-preauth",
  limit: 5,
  period: 60,
});
const COMPRESSION_RATE_LIMIT = Object.freeze({
  binding: "COMPRESSION_RATE_LIMITER",
  limit: 5,
  period: 60,
});
const COMPRESSION_TOKEN_RATE_LIMIT = Object.freeze({
  binding: "COMPRESSION_TOKEN_RATE_LIMITER",
  keyPrefix: "semantic-compression-auth",
  key: (c) => c.get("compressionAuthFingerprint"),
  limit: 5,
  period: 60,
});
const JEV_AUDIT_PREAUTH_RATE_LIMIT = Object.freeze({
  binding: "JEV_AUDIT_PREAUTH_RATE_LIMITER",
  keyPrefix: "jev-audit-preauth",
  limit: 5,
  period: 60,
});
const JEV_AUDIT_RATE_LIMIT = Object.freeze({
  binding: "JEV_AUDIT_RATE_LIMITER",
  keyPrefix: "jev-audit",
  limit: 5,
  period: 60,
});
const JEV_AUDIT_TOKEN_RATE_LIMIT = Object.freeze({
  binding: "JEV_AUDIT_TOKEN_RATE_LIMITER",
  keyPrefix: "jev-audit-auth",
  key: (c) => c.get("jevAuditAuthFingerprint"),
  limit: 5,
  period: 60,
});

export const routePolicies = Object.freeze({
  health: Object.freeze({
    id: "health",
    path: "/health",
    method: "GET",
    rateLimit: GENERAL_RATE_LIMIT,
  }),
  time: Object.freeze({
    id: "time",
    path: "/v1/time",
    method: "GET",
    rateLimit: GENERAL_RATE_LIMIT,
  }),
  weather: Object.freeze({
    id: "weather",
    path: "/v1/weather",
    method: "GET",
    rateLimit: GENERAL_RATE_LIMIT,
    validateQuery: validateCoordinatesQuery,
  }),
  rokuyo: Object.freeze({
    id: "rokuyo",
    path: "/v1/calendar/rokuyo",
    method: "GET",
    rateLimit: GENERAL_RATE_LIMIT,
    validateQuery: validateDateQuery,
  }),
  moon: Object.freeze({
    id: "moon",
    path: "/v1/astronomy/moon",
    method: "GET",
    rateLimit: GENERAL_RATE_LIMIT,
    validateQuery: validateCoordinatesQuery,
  }),
  capabilities: Object.freeze({
    id: "capabilities",
    path: "/v1/capabilities",
    method: "GET",
    rateLimit: GENERAL_RATE_LIMIT,
  }),
  rubyParse: Object.freeze({
    id: "ruby-parse",
    path: "/v1/ruby/parse",
    method: "POST",
    bodyType: "json",
    bodyLimitBytes: 512 * 1024,
    rateLimit: TEXT_RATE_LIMIT,
    validateBody: validateRubyBody,
  }),
  transform: Object.freeze({
    id: "transform",
    path: "/v1/transform",
    method: "POST",
    bodyType: "json",
    bodyLimitBytes: 512 * 1024,
    rateLimit: TEXT_RATE_LIMIT,
    validateBody: validateTransformBody,
  }),
  transformBatch: Object.freeze({
    id: "transform-batch",
    path: "/v1/transform/batch",
    method: "POST",
    bodyType: "json",
    bodyLimitBytes: 1024 * 1024,
    rateLimit: TEXT_RATE_LIMIT,
    validateBody: validateBatchBody,
  }),
  compression: Object.freeze({
    id: "semantic-compression",
    path: "/v1/compress",
    method: "POST",
    bodyType: "json",
    bodyLimitBytes: COMPRESSION_BODY_LIMIT_BYTES,
    preAuthRateLimit: COMPRESSION_PREAUTH_RATE_LIMIT,
    rateLimit: COMPRESSION_RATE_LIMIT,
    tokenRateLimit: COMPRESSION_TOKEN_RATE_LIMIT,
    authenticate: authenticateCompression,
    validateBody: validateCompressionBody,
    upstreamTimeoutMs: 50_000,
  }),
  jevAudit: Object.freeze({
    id: "jev-audit",
    path: "/v1/audit",
    method: "POST",
    bodyType: "json",
    bodyLimitBytes: REMOTE_AUDIT_LIMITS.maxRequestBytes,
    preAuthRateLimit: JEV_AUDIT_PREAUTH_RATE_LIMIT,
    rateLimit: JEV_AUDIT_RATE_LIMIT,
    tokenRateLimit: JEV_AUDIT_TOKEN_RATE_LIMIT,
    authenticate: authenticateJevAudit,
    validateBody: validateJevAuditBody,
    upstreamTimeoutMs: 50_000,
  }),
});
