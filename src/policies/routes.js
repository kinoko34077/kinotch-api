import {
  validateBatchBody,
  validateCoordinatesQuery,
  validateDateQuery,
  validateRubyBody,
  validateTransformBody,
} from "../middleware/validation.js";

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
});

