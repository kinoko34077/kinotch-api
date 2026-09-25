import { verifyAccessJwt } from "./jev-audit-mcp/access-auth.js";
import { inspectJevAuditMcpBodyLimit } from "./jev-audit-mcp/body-limit.js";
import { createJevAuditMcpHandler } from "./jev-audit-mcp/server.js";

function errorResponse(code, status) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function createJevAuditMcpWorker({
  verifyAccessJwtImpl = verifyAccessJwt,
  createJevAuditMcpHandlerImpl = createJevAuditMcpHandler,
} = {}) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname !== "/mcp") return errorResponse("not_found", 404);

      const authentication = await verifyAccessJwtImpl(request, env);
      if (!authentication.ok) {
        return errorResponse(authentication.code, authentication.code === "authentication_unavailable" ? 503 : 401);
      }

      const bodyLimit = await inspectJevAuditMcpBodyLimit(request);
      if (!bodyLimit.ok) {
        return errorResponse(bodyLimit.code, bodyLimit.code === "payload_too_large" ? 413 : 400);
      }

      const handlerEnv = authentication.actorKey
        ? { ...env, MCP_ACCESS_ACTOR_KEY: authentication.actorKey }
        : env;
      try {
        return await createJevAuditMcpHandlerImpl(handlerEnv)(request, handlerEnv, ctx);
      } catch {
        return errorResponse("internal_error", 500);
      }
    },
  };
}

export default createJevAuditMcpWorker();
