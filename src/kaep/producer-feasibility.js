/**
 * KAEP H2: bounded, OFFLINE feasibility arithmetic for future source Producers.
 *
 * No Worker route, network call, authority check, cache writer or scheduler.
 * It never makes an operational admission decision. GitHub and Cloudflare
 * published values are modeling inputs, not a user's current quota.
 */
export const KAEP_PRODUCER_REFERENCE_LIMITS = Object.freeze({
  githubUnauthenticatedRestRequestsPerHour: 60,
  cloudflareFreeExternalSubrequestsPerInvocation: 50,
  cloudflareFreeRequestsPerDay: 100_000,
  cloudflareFreeCpuMsPerInvocation: 10,
  targetObservationAgeSeconds: 60,
});

const HOSTS = Object.freeze([
  "public_worker_unauthenticated",
  "owner_pc_one_shot",
  "github_actions_event",
  "github_app_broker",
]);

const MAX_COUNT = 1_000_000;
function boundedInteger(n, min, max = MAX_COUNT) {
  return Number.isSafeInteger(n) && n >= min && n <= max;
}

/**
 * Estimate only the lower bound of repo-comments GET consumption.
 *
 * Real API pages, the repository-list call, strict original-Issue GET,
 * pagination, source revisions, retry/backoff and shared-IP consumption
 * make real request cost HIGHER. Never use estimates to grant deployment.
 */
export function assessKaepPollingFeasibility({
  host,
  publicRepositories,
  historicalBaselineRequests,
  refreshSeconds,
  minimumCommentPagesPerRepository = 1,
  githubUnauthenticatedRestRequestsPerHour =
    KAEP_PRODUCER_REFERENCE_LIMITS.githubUnauthenticatedRestRequestsPerHour,
  workerExternalSubrequestsPerInvocation =
    KAEP_PRODUCER_REFERENCE_LIMITS.cloudflareFreeExternalSubrequestsPerInvocation,
  maxObservationAgeSeconds = KAEP_PRODUCER_REFERENCE_LIMITS.targetObservationAgeSeconds,
} = {}) {
  if (!HOSTS.includes(host)
      || !boundedInteger(publicRepositories, 1, 1000)
      || !boundedInteger(historicalBaselineRequests, 0)
      || !boundedInteger(refreshSeconds, 1, 86_400)
      || !boundedInteger(minimumCommentPagesPerRepository, 1, 40)
      || !boundedInteger(githubUnauthenticatedRestRequestsPerHour, 1)
      || !boundedInteger(workerExternalSubrequestsPerInvocation, 1)
      || !boundedInteger(maxObservationAgeSeconds, 1, 3600)) {
    throw new TypeError("INVALID_KAEP_PRODUCER_ASSUMPTIONS");
  }

  const estimatedScansPerHour = Math.ceil(3600 / refreshSeconds);
  const minimumGetPerScan = 1 + publicRepositories * minimumCommentPagesPerRepository;
  const minimumGetPerHour = estimatedScansPerHour * minimumGetPerScan;
  const firstFullSweepNeedsMultipleWorkerInvocations =
    historicalBaselineRequests > workerExternalSubrequestsPerInvocation;
  const unauthenticatedGitHubBudgetExceeded =
    minimumGetPerHour > githubUnauthenticatedRestRequestsPerHour;
  const targetFreshnessUnachievableFromThisCadence =
    refreshSeconds > maxObservationAgeSeconds;
  const reasons = [
    ...(firstFullSweepNeedsMultipleWorkerInvocations ?
      ["BASELINE_EXCEEDS_SINGLE_FREE_WORKER_SUBREQUEST_BOUND"] : []),
    ...(unauthenticatedGitHubBudgetExceeded ?
      ["UNAUTHENTICATED_GITHUB_REST_LOWER_BOUND_EXCEEDS_REFERENCE_LIMIT"] : []),
    ...(targetFreshnessUnachievableFromThisCadence ?
      ["CADENCE_EXCEEDS_FRESHNESS_TARGET"] : []),
    ...(host === "owner_pc_one_shot" ?
      ["ONE_SHOT_OWNER_PC_IS_NOT_UNATTENDED_HOST"] : []),
    ...(host === "github_actions_event" ?
      ["WORKFLOW_EVENT_COVERAGE_AND_RUNNER_AUTH_NOT_PROVEN"] : []),
    ...(host === "github_app_broker" ?
      ["GITHUB_APP_INSTALLATION_AUTH_AND_PERMISSIONS_NOT_ADMITTED"] : []),
    ...(host === "public_worker_unauthenticated" ?
      ["PUBLIC_HTTP_CALLER_NOT_AUTHENTICATED"] : []),
    "CANONICAL_PYTHON_SOURCE_PRODUCER_NOT_CONNECTED",
    "RECIPIENT_AUTHENTICATION_AND_RELEASE_NOT_ADMITTED",
  ];
  return {
    schema_version: "kaep.producer-feasibility.v0.1",
    kind: "OFFLINE_LOWER_BOUND_AND_SECURITY_HOLD",
    host,
    public_repositories: publicRepositories,
    historical_baseline_requests: historicalBaselineRequests,
    refresh_seconds: refreshSeconds,
    target_observation_age_seconds: maxObservationAgeSeconds,
    estimated_scans_per_hour: estimatedScansPerHour,
    minimum_get_per_scan: minimumGetPerScan,
    minimum_get_per_hour: minimumGetPerHour,
    reference_unauthenticated_github_limit_per_hour:
      githubUnauthenticatedRestRequestsPerHour,
    reference_free_worker_external_subrequests:
      workerExternalSubrequestsPerInvocation,
    first_full_sweep_needs_multiple_worker_invocations:
      firstFullSweepNeedsMultipleWorkerInvocations,
    unauthenticated_github_budget_exceeded: unauthenticatedGitHubBudgetExceeded,
    target_freshness_unachievable_from_cadence:
      targetFreshnessUnachievableFromThisCadence,
    host_identity_verified: false,
    source_provenance_verified: false,
    automatic_trigger_verified: false,
    admission: "HOLD_H3_HOST_IDENTITY_AND_SOURCE_PROOF",
    reasons,
    // The lower bound is NOT evidence of acceptable cost or security.
    complete_source_universe: false,
    real_provider_or_cloudflare_cost_verified: false,
    can_authorize_deployment: false,
    can_authorize_execution: false,
    can_grant_recipient_claim: false,
    http_endpoint_deployed: false,
    read_only: true,
  };
}
