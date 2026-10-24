import { Hono } from "hono";
import { registerRoute } from "../middleware/guard.js";
import { routePolicies } from "../policies/routes.js";
import { proxyToWorker } from "../services/proxy.js";

export const apiRoutes = new Hono();

registerRoute(apiRoutes, "GET", "/health", routePolicies.health, (c) =>
  c.json({ status: "ok", service: "kinotch-api", version: "v1" }),
);

registerRoute(apiRoutes, "GET", "/v1/time", routePolicies.time, (c) =>
  proxyToWorker(c, c.env.CLOCK_SERVER, "/"),
);

registerRoute(apiRoutes, "GET", "/v1/weather", routePolicies.weather, (c) => {
  const lat = c.req.query("lat");
  const lon = c.req.query("lon");

  const target = new URL("https://internal.invalid/");
  target.searchParams.set("lat", lat);
  target.searchParams.set("lon", lon);
  return proxyToWorker(c, c.env.WEATHER_PROXY, target);
});

registerRoute(apiRoutes, "GET", "/v1/calendar/rokuyo", routePolicies.rokuyo, (c) => {
  const date = c.req.query("date");

  const target = new URL("https://internal.invalid/");
  target.searchParams.set("rokuyo", "");
  target.searchParams.set("date", date);
  return proxyToWorker(c, c.env.ROKUYO_PROXY, target);
});

registerRoute(apiRoutes, "GET", "/v1/astronomy/moon", routePolicies.moon, (c) => {
  const lat = c.req.query("lat");
  const lon = c.req.query("lon");

  const target = new URL("https://internal.invalid/");
  target.searchParams.set("moon", "");
  target.searchParams.set("lat", lat);
  target.searchParams.set("lon", lon);
  return proxyToWorker(c, c.env.ROKUYO_PROXY, target);
});

registerRoute(apiRoutes, "GET", "/v1/capabilities", routePolicies.capabilities, (c) =>
  proxyToWorker(c, c.env.TEXT_TRANSFORM, "/v1/capabilities"),
);

registerRoute(apiRoutes, "POST", "/v1/ruby/parse", routePolicies.rubyParse, (c) =>
  proxyToWorker(c, c.env.TEXT_TRANSFORM, "/v1/ruby/parse", {
    method: "POST",
    headers: { "Content-Type": c.req.header("content-type") ?? "application/json" },
  }),
);

registerRoute(apiRoutes, "POST", "/v1/transform", routePolicies.transform, (c) =>
  proxyToWorker(c, c.env.TEXT_TRANSFORM, "/v1/transform", {
    method: "POST",
    headers: { "Content-Type": c.req.header("content-type") ?? "application/json" },
  }),
);

registerRoute(apiRoutes, "POST", "/v1/transform/batch", routePolicies.transformBatch, (c) =>
  proxyToWorker(c, c.env.TEXT_TRANSFORM, "/v1/transform/batch", {
    method: "POST",
    headers: { "Content-Type": c.req.header("content-type") ?? "application/json" },
  }),
);

registerRoute(apiRoutes, "POST", "/v1/compress", routePolicies.compression, (c) =>
  proxyToWorker(c, c.env.COMPRESSION, "/v1/compress", {
    method: "POST",
    headers: { "Content-Type": c.req.header("content-type") ?? "application/json" },
    timeoutMs: routePolicies.compression.upstreamTimeoutMs,
  }),
);

registerRoute(apiRoutes, "POST", "/v1/audit", routePolicies.jevAudit, (c) =>
  proxyToWorker(c, c.env.JEV_AUDIT, "/v1/audit", {
    method: "POST",
    headers: {
      "Content-Type": c.req.header("content-type") ?? "application/json",
      "X-Kinotch-Jev-Surface": "rest",
    },
    timeoutMs: routePolicies.jevAudit.upstreamTimeoutMs,
  }),
);

/**
 * SHA/repository/workflow claims and GitHub RS256/JWKS are verified ONLY by the
 * private Identity Worker. The Gateway is a bounded transport, not a verifier.
 * No session exchange, raw data proxy, URL injection, or credential exposure.
 */
registerRoute(apiRoutes, "POST", "/v1/identity/catalog/read", routePolicies.identityCatalogRead, (c) => {
  if (new URL(c.req.url).search !== "") {
    return c.json({ error: "invalid_query" }, 400);
  }
  const authorization = c.req.header("authorization");
  if (typeof authorization !== "string" || authorization.length > 8200 ||
      !/^Bearer [A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/.test(authorization)) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  // Empty request payload enforced by the existing shared policy body limiter.
  // Only the explicitly configured private Worker may receive the bearer JWT.
  return proxyToWorker(c, c.env.IDENTITY_PILOT,
    "/internal/v1/identity/catalog/read", {
      method: "POST",
      body: null,
      headers: { Authorization: authorization, Accept: "application/json" },
      timeoutMs: routePolicies.identityCatalogRead.upstreamTimeoutMs,
    });
});
