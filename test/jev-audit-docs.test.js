import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = Object.freeze({
  jev: new URL("../docs/jev-audit.md", import.meta.url),
  readme: new URL("../README.md", import.meta.url),
  usage: new URL("../docs/USAGE.md", import.meta.url),
  operations: new URL("../docs/OPERATIONS.md", import.meta.url),
  history: new URL("../docs/DEVELOPMENT_HISTORY.md", import.meta.url),
  changelog: new URL("../CHANGELOG.md", import.meta.url),
  currentState: new URL("../project/docs/CURRENT_STATE.md", import.meta.url),
});

async function loadDocumentation() {
  const entries = await Promise.all(
    Object.entries(files).map(async ([name, url]) => [name, await readFile(url, "utf8")]),
  );
  return Object.freeze(Object.fromEntries(entries));
}

test("jev-audit remote documentation fixes public surfaces and v0.2.12 provenance", async () => {
  const docs = await loadDocumentation();
  const combined = Object.values(docs).join("\n");

  assert.match(docs.jev, /POST\s+`?\/v1\/audit`?/i);
  assert.match(docs.jev, /https:\/\/jev-audit-mcp\.kinotch\.workers\.dev\/mcp/);
  assert.match(docs.jev, /`audit_files`/);
  assert.match(docs.jev, /`list_profiles`/);
  assert.match(docs.jev, /0\.2\.12/);
  assert.match(combined, /\/v1\/audit/);
  assert.match(combined, /jev-audit-mcp\.kinotch\.workers\.dev\/mcp/);
});

test("jev-audit remote v1 documents snapshot-only input and no remote changed_only", async () => {
  const docs = await loadDocumentation();
  assert.match(docs.jev, /explicit file snapshots/i);
  assert.match(docs.jev, /does not read[^\n]*(local filesystem|filesystem)[^\n]*Git/i);
  assert.match(docs.jev, /no `changed_only`/i);
});

test("jev-audit secrets are assigned to the correct worker boundaries without exposing TypeSafe to public workers", async () => {
  const docs = await loadDocumentation();
  assert.match(docs.jev, /`JEV_AUDIT_API_TOKEN`[^\n]*Gateway/i);
  assert.match(docs.jev, /`TYPESAFE_API_KEY`[^\n]*private[^\n]*jev-audit Worker/i);
  assert.match(docs.jev, /`TEAM_DOMAIN`[^\n]*jev-audit-mcp/i);
  assert.match(docs.jev, /`JEV_AUDIT_MCP_POLICY_AUD`[^\n]*jev-audit-mcp/i);
  assert.match(docs.jev, /`TYPESAFE_API_KEY`[^\n]*(not configured|must not be configured)[^\n]*(Gateway|MCP)/i);
});

test("jev-audit documentation keeps source bodies out of logs and live E2E pending until executed", async () => {
  const docs = await loadDocumentation();
  assert.match(docs.jev, /(source|diff)[^\n]*(not[^\n]*log|must not[^\n]*log)/i);
  assert.match(docs.currentState, /Jev Audit Remote[^\n]*implemented/i);
  assert.match(docs.currentState, /Jev Audit[^\n]*(live E2E|production)[^\n]*pending/i);
  assert.match(docs.history, /Jev Audit Remote/i);
  assert.match(docs.changelog, /Jev Audit Remote/i);
  assert.match(docs.operations, /JEV_AUDIT_SMOKE_TOKEN/);
  assert.match(docs.readme, /docs\/jev-audit\.md/);
  assert.match(docs.usage, /docs\/jev-audit\.md/);
});
