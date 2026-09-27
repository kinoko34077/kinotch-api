import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = Object.freeze({
  jev: new URL("../docs/jev-audit.md", import.meta.url),
  guide: new URL("../docs/jev-audit-guide.md", import.meta.url),
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

test("jev-audit documentation records production verification and Service Token as the accepted Jev MCP path", async () => {
  const docs = await loadDocumentation();
  assert.match(docs.jev, /(source|diff)[^\n]*(not[^\n]*log|must not[^\n]*log)/i);
  assert.match(docs.jev, /Production verified/i);
  assert.match(docs.jev, /Service Token[^\n]*(accepted|required|production)/i);

  assert.match(docs.currentState, /Jev Audit Production release[^\n]*completed/i);
  assert.match(docs.currentState, /Jev Audit MCP Service Token E2E:\s*PASS/i);
  assert.doesNotMatch(docs.currentState, /Jev Audit[^\n]*(live E2E|production)[^\n]*pending/i);

  assert.match(docs.usage, /Jev Audit Remote[^\n]*(Production verified|production verified)/i);
  assert.match(docs.usage, /Service Token[^\n]*(normal|accepted|Production)/i);
  assert.doesNotMatch(docs.usage, /Jev Audit[^\n]*(live TypeSafe|Production deploy|authenticated Jev Audit MCP)[^\n]*pending/i);

  assert.match(docs.operations, /\*\*Production verified\*\*:[^\n]*source revision/i);
  assert.match(docs.operations, /authenticated Jev MCP Service Token E2E[^\n]*HTTP 200/i);
  assert.match(docs.operations, /JEV_AUDIT_SMOKE_TOKEN/);
  assert.doesNotMatch(docs.operations, /Jev Audit[^\n]*(live TypeSafe|Production deploy|authenticated MCP)[^\n]*pending/i);

  assert.match(docs.history, /Jev Audit Remote/i);
  assert.match(docs.changelog, /Jev Audit Remote/i);
  assert.match(docs.readme, /docs\/jev-audit\.md/);
  assert.match(docs.readme, /Jev Audit[^\n]*(Production verified|production verified)/i);
});

test("jev-audit history benchmark docs record deployed Production verification", async () => {
  const docs = await loadDocumentation();
  assert.match(docs.jev, /`JEV_AUDIT_BENCHMARK_STATE`/);
  assert.match(docs.jev, /history \+ rolling benchmark[^\n]*Production verified/i);
  assert.match(docs.guide, /history \+ rolling benchmark[^\n]*Production verified/i);
  assert.match(docs.currentState, /`JEV_AUDIT_BENCHMARK_STATE`/);
  assert.match(docs.currentState, /20260927T083120814Z\.json/);
  assert.match(docs.currentState, /jev-audit-20260927T083122160Z\.json/);
  assert.match(docs.currentState, /structured history[^\n]*(rest|REST)[^\n]*(remote_mcp|MCP)/i);
  assert.doesNotMatch(docs.currentState, /Production release[^\n]*pending/i);
  assert.doesNotMatch(docs.currentState, /post-release repository hardening[^\n]*not Production evidence/i);
  assert.doesNotMatch(docs.currentState, /Carry the post-release Jev hardening into Production/i);
  assert.doesNotMatch(docs.currentState, /create and attach the single Jev benchmark KV namespace/i);
  assert.doesNotMatch(docs.guide, /formal release[^\n]*Production[^\n]*deploy/i);
  assert.doesNotMatch(docs.jev, /次回[^\n]*release[^\n]*Production/);
});

test("jev-audit benchmark docs expose the bounded runtime sample-rate control", async () => {
  const docs = await loadDocumentation();
  assert.match(docs.jev, /`JEV_AUDIT_BENCHMARK_SAMPLE_RATE`/);
  assert.match(docs.jev, /`0`[^\n]*(disable|kill switch)/i);
  assert.match(docs.currentState, /`JEV_AUDIT_BENCHMARK_SAMPLE_RATE`/);
});

test("jev-audit docs define the bounded benchmark sample-rate control", async () => {
  const docs = await loadDocumentation();
  const combined = `${docs.jev}\n${docs.guide}\n${docs.currentState}`;
  assert.match(combined, /JEV_AUDIT_BENCHMARK_SAMPLE_RATE/);
  assert.match(combined, /default[^\n]*1|unset[^\n]*1/i);
  assert.match(combined, /0[^\n]*(disable|disables)/i);
  assert.match(combined, /benchmark_config_error/);
});
