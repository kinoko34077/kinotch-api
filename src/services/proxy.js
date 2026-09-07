export async function proxyToWorker(c, service, target, init = {}) {
  const url = target instanceof URL
    ? target
    : new URL(target, "https://internal.invalid");
  const method = init.method ?? "GET";
  const requestInit = { ...init, method };
  if (method !== "GET" && method !== "HEAD" && requestInit.body === undefined) {
    requestInit.body = await c.req.raw.clone().arrayBuffer();
  }
  const response = await service.fetch(new Request(url, requestInit));
  const body = await response.text();
  const headers = new Headers();
  const contentType = response.headers.get("content-type");

  if (contentType) {
    headers.set("Content-Type", contentType);
  }

  return new Response(body, { status: response.status, headers });
}
