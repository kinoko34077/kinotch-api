/** KAEP P3-B H1: isolated fake-only HTTP response contract.
 *
 * Not registered in any Hono route. Authentication is intentionally an
 * injected *preverified* test principal; this is NOT a real auth mechanism.
 * Only a deployed future gateway with independent identity verification may
 * call this function with a verified caller.
 */
import { z } from "zod";

const RECIPIENTS = ["chatgpt", "claude-code", "codex", "coordinator"];
const repo = z.string().regex(/^kinoko34077\/[A-Za-z0-9_.-]+$/);
const reason = z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);
const requestId = z.string().regex(/^msg_[A-Za-z0-9_-]{1,72}$/);

const Row = z.strictObject({
  repository: repo,
  issue_number: z.number().int().positive(),
  issue_url: z.url(),
  source_url: z.url(),
  source_comment_id: z.number().int().positive(),
  message_id: requestId,
  recipient: z.enum(RECIPIENTS),
  issue_state: z.enum(["open", "closed"]),
  reply_observation: reason,
  source_validation: z.enum(["STRICT_COMPLETE_FOR_CANDIDATE", "PARTIAL_UNKNOWN"]),
  is_authoritative_assignment: z.literal(false),
});
const Candidate = z.strictObject({
  repository: repo,
  issue_number: z.number().int().positive(),
  issue_url: z.url(),
  matching_recipient_roots: z.number().int().nonnegative(),
  source_observation: z.enum([
    "ACCEPTED_RECIPIENT_ROOTS",
    "NO_ACCEPTED_RECIPIENT_ROOT_OBSERVED",
    "SOURCE_VALIDATION_UNKNOWN",
  ]),
  candidate_origin: reason,
  grants_work_authority: z.literal(false),
});
const ErrorItem = z.strictObject({
  reason_code: reason,
  issue_url: z.url().nullable(),
});
const WarningItem = z.strictObject({
  repository: repo,
  reason_code: reason,
});
export const kaepAgentViewSchema = z.strictObject({
  schema_version: z.literal("kaep.agent-current-view.v0.1"),
  kind: z.literal("SAME_RUN_STRICT_SOURCE_OBSERVATION_NOT_HOSTED"),
  status: z.enum(["BOUNDED_UNION_READ", "PARTIAL_UNKNOWN"]),
  recipient: z.enum(RECIPIENTS),
  observed_at: z.string().min(1).max(64),
  observation_age_seconds: z.number().int().nonnegative(),
  observation_within_target_age: z.boolean(),
  freshness_limit_seconds: z.number().int().positive().max(3600),
  repositories_checked: z.array(repo).min(1).max(3),
  source_issues_checked: z.number().int().nonnegative().max(40),
  rows: z.array(Row).max(4000),
  candidates: z.array(Candidate).max(40),
  source_errors: z.array(ErrorItem).max(100),
  warnings: z.array(WarningItem).max(100),
  has_unknown_work: z.literal(true),
  complete_source_universe: z.literal(false),
  absence_of_work_proven: z.literal(false),
  recipient_pickup_proven: z.literal(false),
  current_head_verified: z.literal(false),
  can_authorize_execution: z.literal(false),
  fallback_retirement_authorized: z.literal(false),
  http_endpoint_deployed: z.literal(false),
  requires_original_source_recheck_before_action: z.literal(true),
  read_only: z.literal(true),
});

const BASE_HEADERS = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store",
  "Vary": "Authorization",
  "X-Content-Type-Options": "nosniff",
});

function failure(status, code, extraHeaders = {}) {
  return new Response(JSON.stringify({ error: code, read_only: true }), {
    status, headers: { ...BASE_HEADERS, ...extraHeaders },
  });
}

function canonicalSource(row) {
  const issue = `https://github.com/${row.repository}/issues/${row.issue_number}`;
  if (row.issue_url !== issue) return false;
  if (row.source_comment_id !== undefined &&
      row.source_url !== `${issue}#issuecomment-${row.source_comment_id}`) return false;
  return true;
}

/** Test-only pure adapter; never register directly as an unauthenticated route.
 *
 * Caller verification, client-specific ratelimiting, Worker secret bindings
 * and actual GitHub source fetching are outside this phase.
 */
export function fakeKaepGatewayResponse({
  requestedRecipient,
  verifiedPrincipal,
  projected,
  rateLimited = false,
  upstreamUnavailable = false,
  nowMs = Date.now(),
} = {}) {
  if (!verifiedPrincipal || verifiedPrincipal.verified !== true ||
      typeof verifiedPrincipal.id !== "string" || !verifiedPrincipal.id.trim()) {
    return failure(401, "authentication_required");
  }
  if (!RECIPIENTS.includes(requestedRecipient) ||
      !Array.isArray(verifiedPrincipal.recipients) ||
      !verifiedPrincipal.recipients.includes(requestedRecipient)) {
    return failure(403, "recipient_forbidden");
  }
  if (rateLimited) return failure(429, "rate_limited", { "Retry-After": "60" });
  if (upstreamUnavailable || typeof projected !== "object" || projected === null) {
    return failure(503, "source_unavailable");
  }

  // Bound serialization before validation; reject any unexpected fields.
  let raw;
  try {
    raw = JSON.stringify(projected);
    if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 262_144) {
      return failure(503, "invalid_source");
    }
  } catch {
    return failure(503, "invalid_source");
  }
  const result = kaepAgentViewSchema.safeParse(projected);
  if (!result.success) return failure(503, "invalid_source");
  const data = result.data;
  if (data.recipient !== requestedRecipient ||
      new Set(data.repositories_checked).size !== data.repositories_checked.length ||
      data.source_issues_checked !== data.candidates.length ||
      !Number.isFinite(nowMs)) {
    return failure(503, "invalid_source");
  }
  const observedMs = Date.parse(data.observed_at);
  if (!Number.isFinite(observedMs) || observedMs > nowMs + 300_000) {
    return failure(503, "invalid_source_time");
  }
  const age = Math.max(0, Math.floor((nowMs - observedMs) / 1000));
  if (age > 60 || !data.observation_within_target_age ||
      Math.abs(data.observation_age_seconds - age) > 10) {
    return failure(503, "source_stale");
  }
  const seen = new Set();
  const roots = new Map();
  for (const r of data.rows) {
    if (!data.repositories_checked.includes(r.repository) || !canonicalSource(r) ||
        r.recipient !== requestedRecipient) return failure(503, "invalid_source");
    const key = `${r.repository}#${r.issue_number}@${r.source_comment_id}:${r.message_id}`;
    if (seen.has(key)) return failure(503, "invalid_source");
    seen.add(key);
    const issue = `${r.repository}#${r.issue_number}`;
    roots.set(issue, (roots.get(issue) ?? 0) + 1);
  }
  const candidates = new Set();
  for (const c of data.candidates) {
    if (!data.repositories_checked.includes(c.repository) || !canonicalSource(c)) {
      return failure(503, "invalid_source");
    }
    const issue = `${c.repository}#${c.issue_number}`;
    if (candidates.has(issue) || c.matching_recipient_roots !== (roots.get(issue) ?? 0)) {
      return failure(503, "invalid_source");
    }
    candidates.add(issue);
  }
  if ([...roots.keys()].some((key) => !candidates.has(key))) {
    return failure(503, "invalid_source");
  }
  for (const e of data.source_errors) {
    if (e.issue_url !== null &&
        !data.candidates.some((c) => c.issue_url === e.issue_url)) {
      return failure(503, "invalid_source");
    }
  }
  for (const w of data.warnings) {
    if (!data.repositories_checked.includes(w.repository)) {
      return failure(503, "invalid_source");
    }
  }

  // Intentionally 200 even on PARTIAL_UNKNOWN: the body explicitly states
  // bounded, incomplete observation; 206 is an HTTP Range status, not this.
  return new Response(JSON.stringify(data), {
    status: 200, headers: BASE_HEADERS,
  });
}
