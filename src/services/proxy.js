export async function proxyToWorker(c, service, target) {
  const url = target instanceof URL
    ? target
    : new URL(target, "https://internal.invalid");
  const response = await service.fetch(new Request(url, { method: "GET" }));
  const body = await response.text();
  const headers = new Headers();
  const contentType = response.headers.get("content-type");

  if (contentType) {
    headers.set("Content-Type", contentType);
  }

  return new Response(body, { status: response.status, headers });
}
