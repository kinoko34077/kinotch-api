import { Hono } from "hono";
import { proxyToWorker } from "../services/proxy.js";

export const apiRoutes = new Hono();

apiRoutes.get("/health", (c) =>
  c.json({ status: "ok", service: "kinotch-api", version: "v1" }),
);

apiRoutes.get("/v1/time", (c) =>
  proxyToWorker(c, c.env.CLOCK_SERVER, "/"),
);

apiRoutes.get("/v1/weather", (c) => {
  const lat = c.req.query("lat");
  const lon = c.req.query("lon");
  if (!lat || !lon) return c.json({ error: "Missing 'lat' or 'lon'" }, 400);

  const target = new URL("https://internal.invalid/");
  target.searchParams.set("lat", lat);
  target.searchParams.set("lon", lon);
  return proxyToWorker(c, c.env.WEATHER_PROXY, target);
});

apiRoutes.get("/v1/calendar/rokuyo", (c) => {
  const date = c.req.query("date");
  if (!date) return c.json({ error: "Missing 'date'" }, 400);

  const target = new URL("https://internal.invalid/");
  target.searchParams.set("rokuyo", "");
  target.searchParams.set("date", date);
  return proxyToWorker(c, c.env.ROKUYO_PROXY, target);
});

apiRoutes.get("/v1/astronomy/moon", (c) => {
  const lat = c.req.query("lat");
  const lon = c.req.query("lon");
  if (!lat || !lon) return c.json({ error: "Missing 'lat' or 'lon'" }, 400);

  const target = new URL("https://internal.invalid/");
  target.searchParams.set("moon", "");
  target.searchParams.set("lat", lat);
  target.searchParams.set("lon", lon);
  return proxyToWorker(c, c.env.ROKUYO_PROXY, target);
});
