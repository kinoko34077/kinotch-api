import { cors } from "hono/cors";

export const corsMiddleware = cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "X-Request-ID"],
  exposeHeaders: [
    "X-Request-ID",
    "Retry-After",
    "RateLimit-Limit",
    "RateLimit-Policy",
    "ETag",
  ],
});
