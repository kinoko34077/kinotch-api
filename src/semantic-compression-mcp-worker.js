import { verifyAccessJwt } from "./semantic-compression-mcp/access-auth.js";
import { inspectMcpBodyLimit } from "./semantic-compression-mcp/body-limit.js";
import { createCompressionMcpHandler } from "./semantic-compression-mcp/server.js";

function errorResponse(code, status) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function createCompressionMcpWorker({
  verifyAccessJwtImpl = verifyAccessJwt,
  createCompressionMcpHandlerImpl = createCompressionMcpHandler,
} = {}) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname !== "/mcp") return errorResponse("not_found", 404);

      const authentication = await verifyAccessJwtImpl(request, env);
      if (!authentication.ok) {
        return errorResponse(authentication.code, authentication.code === "authentication_unavailable" ? 503 : 401);
      }

      const bodyLimit = await inspectMcpBodyLimit(request);
      if (!bodyLimit.ok) {
        return errorResponse(bodyLimit.code, bodyLimit.code === "payload_too_large" ? 413 : 400);
      }

      const handlerEnv = authentication.actorKey
        ? { ...env, MCP_ACCESS_ACTOR_KEY: authentication.actorKey }
        : env;
      try {
        return await createCompressionMcpHandlerImpl(handlerEnv)(request, handlerEnv, ctx);
      } catch {
        return errorResponse("internal_error", 500);
      }
    },
  };
}

export default createCompressionMcpWorker();
