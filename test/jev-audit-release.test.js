import assert from "node:assert/strict";
import test from "node:test";

import { createReleaseChildEnv } from "../scripts/release-child-env.mjs";
import {
  JEV_AUDIT_MCP_CONFIG,
  JEV_AUDIT_MCP_ENDPOINT,
  JEV_AUDIT_MCP_WORKER_NAME,
  JEV_AUDIT_PRIVATE_CONFIG,
  JEV_AUDIT_PRIVATE_WORKER_NAME,
  createJevAuditMcpDeployArgs,
  createJevAuditPrivateDeployArgs,
  resolveJevAuditReleaseInputs,
} from "../scripts/jev-audit-release.mjs";

test("jev-audit release pins worker names configs and MCP endpoint", () => {
  assert.equal(JEV_AUDIT_PRIVATE_WORKER_NAME, "jev-audit");
  assert.equal(JEV_AUDIT_PRIVATE_CONFIG, "wrangler.jev-audit.jsonc");
  assert.equal(JEV_AUDIT_MCP_WORKER_NAME, "jev-audit-mcp");
  assert.equal(JEV_AUDIT_MCP_CONFIG, "wrangler.jev-audit-mcp.jsonc");
  assert.equal(JEV_AUDIT_MCP_ENDPOINT, "https://jev-audit-mcp.kinotch.workers.dev/mcp");
});

test("release inputs require dedicated REST smoke and shared Access service-token values without leaking them into deploy args", () => {
  const env = {
    TEAM_DOMAIN: "https://example.cloudflareaccess.com",
    JEV_AUDIT_MCP_POLICY_AUD: "jev-aud",
    JEV_AUDIT_SMOKE_TOKEN: "rest-secret",
    CF_ACCESS_CLIENT_ID: "client-id",
    CF_ACCESS_CLIENT_SECRET: "client-secret",
  };
  const inputs = resolveJevAuditReleaseInputs(env);
  assert.equal(inputs.restSmokeToken, "rest-secret");
  assert.equal(inputs.mcpSmoke.accessClientId, "client-id");
  assert.equal(inputs.mcpSmoke.accessClientSecret, "client-secret");
  assert.equal(inputs.mcpSmoke.endpoint, JEV_AUDIT_MCP_ENDPOINT);

  const privateArgs = createJevAuditPrivateDeployArgs({ dryRun: true });
  assert.deepEqual(privateArgs, ["wrangler", "deploy", "--config", JEV_AUDIT_PRIVATE_CONFIG, "--dry-run"]);

  const mcpArgs = createJevAuditMcpDeployArgs({ env, dryRun: true });
  const joined = mcpArgs.join(" ");
  assert.match(joined, /TEAM_DOMAIN:https:\/\/example\.cloudflareaccess\.com/);
  assert.match(joined, /POLICY_AUD:jev-aud/);
  assert.doesNotMatch(joined, /rest-secret|client-id|client-secret|CF_Authorization/);
});

test("release child environments strip jev-audit, TypeSafe, and Access service-token secrets", () => {
  const child = createReleaseChildEnv({
    PATH: "/bin",
    TYPESAFE_API_KEY: "provider-secret",
    JEV_AUDIT_API_TOKEN: "gateway-secret",
    JEV_AUDIT_SMOKE_TOKEN: "smoke-secret",
    JEV_AUDIT_MCP_POLICY_AUD: "aud-secret",
    CF_ACCESS_CLIENT_ID: "client-id",
    CF_ACCESS_CLIENT_SECRET: "client-secret",
  });
  assert.equal(child.PATH, "/bin");
  assert.equal(child.TYPESAFE_API_KEY, undefined);
  assert.equal(child.JEV_AUDIT_API_TOKEN, undefined);
  assert.equal(child.JEV_AUDIT_SMOKE_TOKEN, undefined);
  assert.equal(child.JEV_AUDIT_MCP_POLICY_AUD, undefined);
  assert.equal(child.CF_ACCESS_CLIENT_ID, undefined);
  assert.equal(child.CF_ACCESS_CLIENT_SECRET, undefined);
});
