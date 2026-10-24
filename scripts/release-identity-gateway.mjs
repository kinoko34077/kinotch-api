/**
 * Approved no-fee release path for the existing public Gateway ONLY.
 * This must never deploy provider Workers or call fee-bearing provider tools.
 * All live changes use the existing production-wide Git release lease,
 * exact-version snapshot and verified rollback engine.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeFeeFreeMcpRelease } from "./release-security-mcp.mjs";
import { assertProductionSourceRevision } from "./production-source-gate.mjs";
import { createReleaseChildEnv } from "./release-child-env.mjs";
import { createNpmInvocation, createWranglerInvocation } from "./wrangler-runner.mjs";
import { acquireProductionReleaseLock, releaseProductionReleaseLock } from "./production-release-lock.mjs";
import { createWorkerRollbackArgs, parseActiveVersionId, rollbackAfterSmokeFailure } from "./release-recovery.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATEWAY = Object.freeze({ name: "api", config: "wrangler.jsonc" });
const TARGET = Object.freeze({
  account: "fb59b3c4a3fb2cda44dad80638390309",
  name: "kinotch-identity-pilot",
  binding: "IDENTITY_PILOT",
  d1Binding: "IDENTITY_REPLAY_DB",
  d1Id: "294b4c27-4554-4ca6-a0a7-d0a0f6c2aa86",
});
const GATEWAY_HOST = "https://api.kinotch.workers.dev";
const REQUIRED_EXISTING = Object.freeze([
  {binding:"CLOCK_SERVER",service:"clock-server"},
  {binding:"WEATHER_PROXY",service:"weather-proxy"},
  {binding:"ROKUYO_PROXY",service:"rokuyo-proxy"},
  {binding:"TEXT_TRANSFORM",service:"text-transform"},
  {binding:"COMPRESSION",service:"semantic-compression"},
  {binding:"JEV_AUDIT",service:"jev-audit"},
]);

export function assertFeeFreeIdentityGatewayConfig(config) {
  if (!config || config.name !== "api" || config.account_id !== TARGET.account ||
      config.workers_dev !== true || config.preview_urls !== false ||
      !Array.isArray(config.services) ||
      config.services.length !== REQUIRED_EXISTING.length + 1 ||
      config.services.some(item => !item || typeof item.binding !== "string" ||
        typeof item.service !== "string") ||
      config.services.some((item, index) => index < REQUIRED_EXISTING.length &&
        (item.binding !== REQUIRED_EXISTING[index].binding ||
         item.service !== REQUIRED_EXISTING[index].service)) ||
      config.services.at(-1).binding !== TARGET.binding ||
      config.services.at(-1).service !== TARGET.name ||
      Object.hasOwn(config, "d1_databases")) {
    throw new Error("Unreviewed Gateway identity binding or account scope");
  }
  return true;
}

async function getPrivatePilotSettings(fetchImpl, token) {
  if (typeof token !== "string" || token.length < 10) {
    throw new Error("Cloudflare deployment token is unavailable");
  }
  const prefix = "https://api.cloudflare.com/client/v4/accounts/" + TARGET.account +
    "/workers/scripts/" + TARGET.name;
  const get = async suffix => {
    const response = await fetchImpl(prefix + suffix, {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 200) throw new Error("Cloudflare private Identity readback unavailable");
    const data = await response.json();
    if (data?.success !== true || !data.result) {
      throw new Error("Cloudflare private Identity readback invalid");
    }
    return data.result;
  };
  const [settings, deployments, subdomain] = await Promise.all([
    get("/settings"), get("/deployments"), get("/subdomain"),
  ]);
  const matches = Array.isArray(settings.bindings) &&
    settings.bindings.length === 1 &&
    settings.bindings[0].name === TARGET.d1Binding &&
    settings.bindings[0].type === "d1" &&
    settings.bindings[0].id === TARGET.d1Id;
  const latest = deployments.deployments?.[0];
  const versions = latest?.versions;
  const deployed = Array.isArray(versions) &&
    versions.length === 1 && Number(versions[0].percentage) === 100 &&
    /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(versions[0].version_id);
  if (!matches || !deployed || subdomain.enabled !== false ||
      subdomain.previews_enabled !== false) {
    throw new Error("Private Identity target is not exactly admitted");
  }
  return versions[0].version_id;
}

export async function verifyLiveGatewayPrivateBinding(fetchImpl, token) {
  if (typeof token !== "string" || token.length < 10) {
    throw new Error("Cloudflare Gateway deployment token unavailable");
  }
  const response = await fetchImpl(
    "https://api.cloudflare.com/client/v4/accounts/" + TARGET.account +
      "/workers/scripts/api/settings",
    {method:"GET",headers:{Authorization:"Bearer " + token},
     redirect:"error",signal:AbortSignal.timeout(15000)},
  );
  if (response.status !== 200) {
    throw new Error("Gateway service binding readback unavailable");
  }
  const data = await response.json();
  const bindings = data?.result?.bindings;
  if (data?.success !== true || !Array.isArray(bindings) ||
      bindings.filter(item => item?.name === TARGET.binding).length !== 1 ||
      !bindings.some(item => item.name === TARGET.binding &&
        item.type === "service" && item.service === TARGET.name)) {
    throw new Error("Gateway live Identity Service Binding differs from expected");
  }
  return true;
}

async function run(command, args, env, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT, env, shell: false,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let output = "";
    if (capture) child.stdout.on("data", chunk => { output += chunk; });
    child.once("error", reject);
    child.once("close", exit => exit === 0 ? resolve(output) :
      reject(new Error("Fee-free Gateway release child command failed")));
  });
}

const normalEnv = () => createReleaseChildEnv(process.env);
const cloudEnv = () => createReleaseChildEnv(process.env, { includeCloudflareCredentials: true });
const git = (args, opts = {}) => run("git", args, normalEnv(), opts.capture === true);
const npm = args => {
  const invocation = createNpmInvocation(args);
  return run(invocation.command, invocation.args, normalEnv());
};
const wrangler = (args, opts = {}) => {
  const invocation = createWranglerInvocation(args, { projectRoot: ROOT });
  return run(invocation.command, invocation.args, cloudEnv(), opts.capture === true);
};
const activeVersion = async () => parseActiveVersionId(
  await wrangler(["deployments", "status", "--name", GATEWAY.name,
    "--json", "--config", GATEWAY.config], {capture:true}),
  "api",
);

async function healthOnly() {
  const response = await fetch(GATEWAY_HOST + "/health", {
    method: "GET", redirect: "error", signal: AbortSignal.timeout(12000),
  });
  if (response.status !== 200) throw new Error("Gateway no-fee health check failed");
  const json = await response.json();
  if (json?.status !== "ok" || json?.service !== "kinotch-api") {
    throw new Error("Gateway health payload invalid");
  }
}

async function noAuthIdentityDeny() {
  for (const authorization of [null, "Bearer header.payload.signature"]) {
    const headers = {};
    if (authorization) headers.Authorization = authorization;
    const response = await fetch(GATEWAY_HOST + "/v1/identity/catalog/read", {
      method: "POST", headers, redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    if (response.status !== 401) {
      throw new Error("Identity Gateway unauthenticated request was not rejected");
    }
  }
}

async function writeRecord(record) {
  const date = new Date().toISOString();
  const folder = path.join(ROOT, "docs", "releases");
  await mkdir(folder, { recursive:true });
  const basename = "identity-gateway-" + date.replaceAll(/[-:.]/g,"") + ".json";
  await writeFile(path.join(folder, basename),
    JSON.stringify({recordedAtUtc:date, ...record},null,2) + "\n", "utf8");
  console.log("Fee-free identity Gateway release recorded: " +
    path.join("docs","releases",basename));
}

export async function runFeeFreeIdentityGatewayRelease() {
  let wasDeployed = false;
  return executeFeeFreeMcpRelease({
    workers: [GATEWAY],
    mode: "fee_free_identity_gateway_only",
    validation: "gateway_health_and_unauthenticated_identity_denial_no_provider_calls",
    async prepare() {
      const [major, minor, patch] = process.versions.node.split(".").map(Number);
      if (major !== 26 || minor < 12 || (minor === 12 && patch < 1)) {
        throw new Error("Patched Node 26.12.1+ required");
      }
      if ((await git(["status","--porcelain"],{capture:true})).trim()) {
        throw new Error("Gateway release worktree is not clean");
      }
      const revision = await assertProductionSourceRevision({ runGit:git });
      const config = JSON.parse(await readFile(path.join(ROOT,GATEWAY.config),"utf8"));
      assertFeeFreeIdentityGatewayConfig(config);
      await getPrivatePilotSettings(fetch, process.env.CLOUDFLARE_API_TOKEN);
      await npm(["ci"]);
      await npm(["test"]);
      await npm(["audit","--omit=dev","--audit-level=high",
        "--fetch-timeout=30000","--fetch-retries=1"]);
      if ((await git(["status","--porcelain"],{capture:true})).trim()) {
        throw new Error("Gateway release checks modified working tree");
      }
      const reread = await assertProductionSourceRevision({runGit:git});
      if (revision.head !== reread.head) {
        throw new Error("Gateway source changed after preflight");
      }
      return revision.head;
    },
    async dryRun() { await wrangler(["deploy","--dry-run","--config",GATEWAY.config]); },
    acquireLock: () => acquireProductionReleaseLock({runGit:git}),
    releaseLock: lease => releaseProductionReleaseLock({runGit:git,lease}),
    activeVersion,
    async deploy() {
      // The only mutation possible under this scoped mode is existing Gateway.
      await wrangler(["deploy","--config",GATEWAY.config]);
      wasDeployed = true;
    },
    discoverySmoke: healthOnly,
    async unauthenticatedSmoke() {
      // Before publishing, old Gateway may correctly have no such route.
      if (wasDeployed) {
        await verifyLiveGatewayPrivateBinding(fetch, process.env.CLOUDFLARE_API_TOKEN);
        await noAuthIdentityDeny();
      }
    },
    async rollback(_, previousVersionId) {
      return rollbackAfterSmokeFailure({
        previousVersionId,
        rollback: version => wrangler(createWorkerRollbackArgs(
          version, "identity-gateway-nonbillable-postflight-failed",
          {workerName:GATEWAY.name,config:GATEWAY.config},
        )),
        getActiveVersionId: activeVersion,
        recoverySmoke: async () => {
          await healthOnly();
          return {status:"passed",mode:"nonbillable_gateway_health"};
        },
      });
    },
    writeRecord,
  });
}
