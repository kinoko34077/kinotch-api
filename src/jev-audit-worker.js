import { Hono } from "hono";

import { validateAuditInput } from "./jev-audit/contract.js";
import { AuditRemoteError, evaluateAudit } from "./jev-audit/evaluator.js";
import { requestIdMiddleware } from "./middleware/request-id.js";

function errorResponse(c, status, code, message) {
  return c.json({
    error: code,
    message,
    ...(c.get("requestId") ? { requestId: c.get("requestId") } : {}),
  }, status);
}

export function createJevAuditWorkerApp({ evaluateAuditImpl = evaluateAudit } = {}) {
  const app = new Hono();

  app.use("*", requestIdMiddleware());
  app.use("/v1/audit", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
    c.header("Cache-Control", "no-store");
  });

  app.all("/v1/audit", async (c, next) => {
    if (c.req.method === "POST") return next();
    c.header("Allow", "POST");
    return errorResponse(c, 405, "method_not_allowed", "Only POST requests are supported");
  });

  app.post("/v1/audit", async (c) => {
    const contentType = c.req.header("Content-Type") ?? "";
    if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType.trim())) {
      return errorResponse(c, 415, "unsupported_media_type", "Content-Type must be application/json");
    }

    let body;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, "invalid_json", "Request body must be valid JSON");
    }

    const validation = validateAuditInput(body);
    if (!validation.ok) {
      return errorResponse(c, validation.status, validation.code, validation.message);
    }

    const apiKey = typeof c.env?.TYPESAFE_API_KEY === "string"
      ? c.env.TYPESAFE_API_KEY.trim()
      : "";
    if (!apiKey) {
      return errorResponse(
        c,
        503,
        "provider_authentication_unavailable",
        "Audit provider authentication is unavailable",
      );
    }

    try {
      const report = await evaluateAuditImpl(c.env, body);
      return c.json(report, 200);
    } catch (error) {
      if (error instanceof AuditRemoteError) {
        if (error.status >= 500) {
          console.error(JSON.stringify({
            event: "jev_audit_provider_error",
            requestId: c.get("requestId") ?? null,
            code: error.code,
            status: error.status,
          }));
        }
        return errorResponse(c, error.status, error.code, "Audit request failed");
      }

      console.error(JSON.stringify({
        event: "jev_audit_internal_error",
        requestId: c.get("requestId") ?? null,
        status: 500,
      }));
      return errorResponse(c, 500, "internal_error", "Audit request failed");
    }
  });

  return app;
}

const app = createJevAuditWorkerApp();
export default app;
