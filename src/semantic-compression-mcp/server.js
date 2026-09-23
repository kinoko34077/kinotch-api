import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import {
  buildMcpProvenance,
  MCP_TOOL_NAME,
  validateCompressTextInput,
} from "./contract.js";
import { enforceMcpCompressionRateLimit } from "./rate-limit.js";
import { callCompressionService, CompressionMcpError } from "./upstream.js";

export const COMPRESS_TEXT_DESCRIPTION = "Meaning-preserving dense compression for long text. Preserves conditions, exceptions, uncertainty, numeric values, proper nouns and logical relationships where possible. Use when reducing long intermediate text before handoff or context reuse. It does not summarize according to caller-supplied instructions.";

function safeToolError(error) {
  const code = error instanceof CompressionMcpError ? error.code : "internal_error";
  return {
    isError: true,
    content: [{ type: "text", text: code }],
  };
}

export function createCompressionMcpServer(env, {
  callCompressionServiceImpl = callCompressionService,
  requestInfo,
} = {}) {
  const server = new McpServer({
    name: "semantic-compression",
    version: "1.0.0",
  });

  server.registerTool(
    MCP_TOOL_NAME,
    {
      description: COMPRESS_TEXT_DESCRIPTION,
      inputSchema: z.object({ text: z.string().min(1) }).strict(),
    },
    async ({ text }) => {
      const input = validateCompressTextInput({ text });
      if (!input.ok) return safeToolError(new CompressionMcpError(input.code, input.code === "payload_too_large" ? 413 : 400));
      try {
        const rateLimitError = await enforceMcpCompressionRateLimit(env, requestInfo);
        if (rateLimitError) return safeToolError(rateLimitError);
        const payload = await callCompressionServiceImpl(env, input.text);
        return {
          content: [{ type: "text", text: payload.compressed_text }],
          structuredContent: buildMcpProvenance(payload),
        };
      } catch (error) {
        return safeToolError(error);
      }
    },
  );

  return server;
}

export function createCompressionMcpHandler(env, {
  createMcpHandlerImpl = createMcpHandler,
} = {}) {
  return createMcpHandlerImpl(
    ({ requestInfo } = {}) => createCompressionMcpServer(env, { requestInfo }),
    {
      route: "/mcp",
      legacy: "stateless",
    },
  );
}
