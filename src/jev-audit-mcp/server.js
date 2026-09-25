import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

import {
  AUDIT_PROFILES,
  REMOTE_AUDIT_LIMITS,
  countUnicodeCodePoints,
  validateAuditInput,
} from "../jev-audit/contract.js";
import { enforceJevAuditMcpRateLimit } from "./rate-limit.js";
import { callJevAuditService, JevAuditMcpError } from "./upstream.js";

const PROFILE_NAMES = Object.freeze(["development", "generic"]);

function safeToolError(error) {
  const code = error instanceof JevAuditMcpError ? error.code : "internal_error";
  return { isError: true, content: [{ type: "text", text: code }] };
}

function fileSchema() {
  return z.object({
    path: z.string().min(1).refine(
      (value) => countUnicodeCodePoints(value) <= REMOTE_AUDIT_LIMITS.maxPathCodePoints,
      { message: `path must not exceed ${REMOTE_AUDIT_LIMITS.maxPathCodePoints} Unicode code points` },
    ),
    content: z.string().min(1),
    change: z.string().optional(),
  }).strict();
}

export function createJevAuditMcpServer(env, {
  callJevAuditServiceImpl = callJevAuditService,
  requestInfo,
} = {}) {
  const server = new McpServer({ name: "jev-audit", version: "1.0.0" });

  server.registerTool(
    "audit_files",
    {
      description: "Run a fast Jev screening audit over explicit file snapshots. Use for remote review when the caller can provide file contents directly.",
      inputSchema: z.object({
        files: z.array(fileSchema()).min(1).max(REMOTE_AUDIT_LIMITS.maxFiles),
        profile: z.enum(PROFILE_NAMES).optional(),
      }).strict(),
    },
    async ({ files, profile }) => {
      const body = { files, ...(profile ? { profile } : {}) };
      const validation = validateAuditInput(body);
      if (!validation.ok) return safeToolError(new JevAuditMcpError(validation.code, validation.status));
      try {
        const rateLimitError = await enforceJevAuditMcpRateLimit(env, requestInfo);
        if (rateLimitError) return safeToolError(rateLimitError);
        const report = await callJevAuditServiceImpl(env, { files, profile: validation.profile });
        return {
          content: [{ type: "text", text: `status=${report.aggregate.overall.status} risk=${report.aggregate.overall.risk}` }],
          structuredContent: report,
        };
      } catch (error) {
        return safeToolError(error);
      }
    },
  );

  server.registerTool(
    "list_profiles",
    {
      description: "List the fixed jev-audit remote profiles.",
      inputSchema: z.object({}).strict(),
    },
    async () => {
      try {
        const rateLimitError = await enforceJevAuditMcpRateLimit(env, requestInfo);
        if (rateLimitError) return safeToolError(rateLimitError);
        const profiles = PROFILE_NAMES.filter((name) => Object.hasOwn(AUDIT_PROFILES, name));
        return {
          content: [{ type: "text", text: profiles.join("\n") }],
          structuredContent: { profiles },
        };
      } catch (error) {
        return safeToolError(error);
      }
    },
  );

  return server;
}

export function createJevAuditMcpHandler(env, { createMcpHandlerImpl = createMcpHandler } = {}) {
  return createMcpHandlerImpl(
    ({ requestInfo } = {}) => createJevAuditMcpServer(env, { requestInfo }),
    { route: "/mcp", legacy: "stateless" },
  );
}
