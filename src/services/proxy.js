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
  if (!service || typeof service.fetch !== "function") {
    throw new UpstreamRequestError("Configured upstream service is unavailable", {
      status: 503,
      code: "upstream_unavailable",
    });
  }

  const configuredTimeoutMs = Number.isFinite(Number(c.env?.UPSTREAM_TIMEOUT_MS))
    ? Number(c.env.UPSTREAM_TIMEOUT_MS)
    : 10_000;
  const timeoutMs = Number.isFinite(Number(init.timeoutMs))
    ? Math.max(0, Number(init.timeoutMs))
    : Math.max(0, configuredTimeoutMs);
  const requestInit = { ...init, method, headers: requestHeaders };
  delete requestInit.timeoutMs;
  const controller = typeof AbortController === "function" && timeoutMs > 0
    ? new AbortController()
    : null;
  if (controller) {
    requestInit.signal = controller.signal;
    requestInit.headers = requestHeaders;
  }
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  if (method !== "GET" && method !== "HEAD" && requestInit.body === undefined) {
    requestInit.body = c.get("requestBodyBytes") ?? await c.req.raw.clone().arrayBuffer();
  }

  let response;
  try {
    response = await service.fetch(new Request(url, requestInit));
  } catch (error) {
    if (timeout) clearTimeout(timeout);
    if (error?.name === "AbortError") {
      throw new UpstreamRequestError("Upstream service timed out", {
        status: 504,
        code: "upstream_timeout",
      });
    }
    throw new UpstreamRequestError("Upstream service request failed", {
      status: 502,
      code: "upstream_failure",
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  const headers = new Headers();
  for (const [name, value] of response.headers) {
    if (shouldForwardHeader(name)) headers.set(name, value);
  }
  if (requestId) headers.set("X-Request-ID", requestId);

  const status = response.status === 503 || response.status === 504
    ? response.status
    : response.status >= 500 ? 502 : response.status;
  return new Response(response.body, {
    status,
    statusText: response.statusText,
    headers,
  });
}
