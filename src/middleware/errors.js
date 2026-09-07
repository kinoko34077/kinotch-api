export function notFoundMiddleware(c) {
  return c.json({ error: "Not found" }, 404);
}

export function errorMiddleware(error, c) {
  console.error(error);
  return c.json({ error: "Upstream request failed" }, 502);
}
