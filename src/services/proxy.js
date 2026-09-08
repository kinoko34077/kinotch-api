import { UpstreamRequestError } from "../middleware/errors.js";

const FORWARDED_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-type",
  "etag",
  "last-modified",
  "retry-after",
  "x-request-id",
]);

function shouldForwardHeader(name) {
  const normalized = name.toLowerCase();
  return FORWARDED_RESPONSE_HEADERS.has(normalized) || normalized.startsWith("ratelimit-");
}

export async function proxyToWorker(c, service, target, init = {}) {
  const url = target instanceof URL
    ? target
    : new URL(target, "https://internal.invalid");
  const method = init.method ?? "GET";
  const requestHeaders = new Headers(init.headers);
  const requestId = c.get("requestId");
  if (requestId) requestHeaders.set("X-Request-ID", requestId);
  const requestInit = { ...init, method, headers: requestHeaders };
  if (method !== "GET" && method !== "HEAD" && requestInit.body === undefined) {
    requestInit.body = c.get("requestBodyBytes") ?? await c.req.raw.clone().arrayBuffer();
  }

  if (!service || typeof service.fetch !== "function") {
    throw new UpstreamRequestError("Configured upstream service is unavailable", {
      status: 503,
      code: "upstream_unavailable",
    });
  }

  let response;
  try {
    response = await service.fetch(new Request(url, requestInit));
  } catch {
    throw new UpstreamRequestError("Upstream service request failed", {
      status: 502,
      code: "upstream_failure",
    });
  }

  const headers = new Headers();
  for (const [name, value] of response.headers) {
    if (shouldForwardHeader(name)) headers.set(name, value);
  }
  if (requestId) headers.set("X-Request-ID", requestId);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
