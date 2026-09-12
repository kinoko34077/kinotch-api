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
