import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSON5 from "json5";

import { assertPrivateWorkerConfig } from "./deploy-guards.mjs";
import { deployWithReconciliation } from "./release-deploy.mjs";
import {
  createWorkerRollbackArgs,
  isMissingWorkerDeploymentError,
  parseOptionalActiveVersionId,
  rollbackAfterSmokeFailure,
} from "./release-recovery.mjs";
import {
  JEV_AUDIT_MCP_CONFIG,
  JEV_AUDIT_MCP_WORKER_NAME,
  JEV_AUDIT_PRIVATE_CONFIG,
  JEV_AUDIT_PRIVATE_WORKER_NAME,
  buildJevAuditReleaseMetadata,
  createJevAuditMcpDeployArgs,
  createJevAuditPrivateDeployArgs,
  resolveJevAuditReleaseInputs,
} from "./jev-audit-release.mjs";
import {
  runJevAuditMcpSmoke,
  runJevAuditRestSmoke,
} from "./smoke-jev-audit.mjs";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseDeployVersionId(output, workerName) {
  const versionId = String(output ?? "").match(/Current Version ID:\s*([0-9a-f-]{36})/i)?.[1];
  if (!versionId) throw new Error(`Could not read the ${workerName} Version ID from Wrangler output`);
  return versionId;
}

function summarizeDeployment(result) {
  if (!result) return null;
  return {
    status: result.status,
    versionId: result.versionId ?? null,
    needsRollback: result.needsRollback === true,
  };
}

export function createJevAuditProductionPhase({
  runWrangler,
  env = process.env,
  projectRoot = defaultProjectRoot,
  onStage = () => {},
  assertPrivateConfig = null,
  runRestSmoke = runJevAuditRestSmoke,
  runMcpSmoke = runJevAuditMcpSmoke,
} = {}) {
  if (typeof runWrangler !== "function") throw new TypeError("runWrangler must be a function");
  if (typeof onStage !== "function") throw new TypeError("onStage must be a function");

  const state = {
    inputs: null,
    prepared: false,
    previousJevAuditPrivateVersionId: null,
    previousJevAuditMcpVersionId: null,
    jevAuditPrivateVersionId: null,
    jevAuditMcpVersionId: null,
    jevAuditPrivateDeployment: null,
    jevAuditMcpDeployment: null,
    jevAuditRestSmoke: null,
    jevAuditMcpSmoke: null,
    jevAuditPrivateRecovery: null,
    jevAuditMcpRecovery: null,
    privateDeployed: false,
    mcpDeployed: false,
  };

  const stage = (name) => onStage(name);

  async function defaultAssertPrivateConfig() {
    const config = JSON5.parse(await readFile(path.join(projectRoot, JEV_AUDIT_PRIVATE_CONFIG), "utf8"));
    assertPrivateWorkerConfig(config, JEV_AUDIT_PRIVATE_WORKER_NAME);
  }

  async function getActiveOptional(workerName, config) {
    const result = await runWrangler([
      "deployments",
      "status",
      "--name",
      workerName,
      "--json",
      "--config",
      config,
    ], { capture: true, allowFailure: true });
    if (result.code !== 0) {
      const diagnostic = `${result.output ?? ""}\n${result.errorOutput ?? ""}`;
      if (isMissingWorkerDeploymentError(diagnostic)) return null;
      throw new Error(`Could not read the ${workerName} deployment status (exit ${result.signal ?? result.code})`);
    }
    return parseOptionalActiveVersionId(result.output, workerName);
  }

  const getActivePrivateVersionId = () => getActiveOptional(
    JEV_AUDIT_PRIVATE_WORKER_NAME,
    JEV_AUDIT_PRIVATE_CONFIG,
  );
  const getActiveMcpVersionId = () => getActiveOptional(
    JEV_AUDIT_MCP_WORKER_NAME,
    JEV_AUDIT_MCP_CONFIG,
  );

  async function prepare() {
    stage("Jev Audit configuration assertion");
    state.inputs = resolveJevAuditReleaseInputs(env);
    await (assertPrivateConfig ?? defaultAssertPrivateConfig)();

    stage("Jev Audit private Worker dry-run");
    await runWrangler(createJevAuditPrivateDeployArgs({ dryRun: true }));
    stage("Jev Audit MCP Worker dry-run");
    await runWrangler(createJevAuditMcpDeployArgs({ env, dryRun: true }));

    stage("capture previous Jev Audit private Worker version");
    state.previousJevAuditPrivateVersionId = await getActivePrivateVersionId();
    stage("capture previous Jev Audit MCP Worker version");
    state.previousJevAuditMcpVersionId = await getActiveMcpVersionId();
    state.prepared = true;
    return metadata();
  }

  async function deploy() {
    if (!state.prepared) throw new Error("Jev Audit production phase must be prepared before deploy");

    stage("Jev Audit private Worker deploy");
    const privateDeployment = await deployWithReconciliation({
      deploy: () => runWrangler(createJevAuditPrivateDeployArgs(), { capture: true }),
      parseVersionId: (output) => parseDeployVersionId(output, JEV_AUDIT_PRIVATE_WORKER_NAME),
      getActiveVersionId: getActivePrivateVersionId,
      previousVersionId: state.previousJevAuditPrivateVersionId,
    });
    state.jevAuditPrivateDeployment = summarizeDeployment(privateDeployment);
    state.privateDeployed = privateDeployment.deployed;
    state.jevAuditPrivateVersionId = privateDeployment.versionId;
    if (privateDeployment.error) throw privateDeployment.error;

    stage("Jev Audit MCP Worker deploy");
    const mcpDeployment = await deployWithReconciliation({
      deploy: () => runWrangler(createJevAuditMcpDeployArgs({ env }), { capture: true }),
      parseVersionId: (output) => parseDeployVersionId(output, JEV_AUDIT_MCP_WORKER_NAME),
      getActiveVersionId: getActiveMcpVersionId,
      previousVersionId: state.previousJevAuditMcpVersionId,
    });
    state.jevAuditMcpDeployment = summarizeDeployment(mcpDeployment);
    state.mcpDeployed = mcpDeployment.deployed;
    state.jevAuditMcpVersionId = mcpDeployment.versionId;
    if (mcpDeployment.error) throw mcpDeployment.error;

    return metadata();
  }

  async function smoke() {
    if (!state.inputs) throw new Error("Jev Audit production phase must be prepared before smoke");
    stage("Jev Audit REST smoke");
    state.jevAuditRestSmoke = await runRestSmoke({ token: state.inputs.restSmokeToken });
    stage("Jev Audit MCP Service Token smoke");
    state.jevAuditMcpSmoke = await runMcpSmoke({
      endpoint: state.inputs.mcpSmoke.endpoint,
      accessClientId: state.inputs.mcpSmoke.accessClientId,
      accessClientSecret: state.inputs.mcpSmoke.accessClientSecret,
      checkToolCall: true,
    });
    return metadata();
  }

  async function recoverOne({
    deployed,
    previousVersionId,
    workerName,
    config,
    reason,
    getActiveVersionId,
    recoverySmoke,
  }) {
    if (!deployed) return { status: "not_deployed" };
    if (!previousVersionId) return { status: "no_previous_version" };
    try {
      return await rollbackAfterSmokeFailure({
        previousVersionId,
        rollback: async (versionId) => runWrangler(createWorkerRollbackArgs(
          versionId,
          reason,
          { workerName, config },
        )),
        getActiveVersionId,
        recoverySmoke,
      });
    } catch (error) {
      return {
        status: "rollback_failed",
        targetVersionId: previousVersionId,
        error: error.message,
      };
    }
  }

  async function recover() {
    if (!state.inputs) return {
      jevAuditMcpRecovery: state.jevAuditMcpRecovery,
      jevAuditPrivateRecovery: state.jevAuditPrivateRecovery,
    };

    if (!state.jevAuditMcpRecovery) {
      stage("Jev Audit MCP rollback recovery");
      state.jevAuditMcpRecovery = await recoverOne({
        deployed: state.mcpDeployed,
        previousVersionId: state.previousJevAuditMcpVersionId,
        workerName: JEV_AUDIT_MCP_WORKER_NAME,
        config: JEV_AUDIT_MCP_CONFIG,
        reason: "automatic-jev-audit-mcp-smoke-failure-rollback",
        getActiveVersionId: getActiveMcpVersionId,
        recoverySmoke: async () => {
          const result = await runMcpSmoke({
            endpoint: state.inputs.mcpSmoke.endpoint,
            accessClientId: state.inputs.mcpSmoke.accessClientId,
            accessClientSecret: state.inputs.mcpSmoke.accessClientSecret,
            checkToolCall: false,
          });
          return { status: result.status, mode: "non_billable_jev_audit_mcp_handshake" };
        },
      });
    }

    if (!state.jevAuditPrivateRecovery) {
      stage("Jev Audit private Worker rollback recovery");
      state.jevAuditPrivateRecovery = await recoverOne({
        deployed: state.privateDeployed,
        previousVersionId: state.previousJevAuditPrivateVersionId,
        workerName: JEV_AUDIT_PRIVATE_WORKER_NAME,
        config: JEV_AUDIT_PRIVATE_CONFIG,
        reason: "automatic-jev-audit-private-smoke-failure-rollback",
        getActiveVersionId: getActivePrivateVersionId,
        recoverySmoke: async () => {
          const result = await runRestSmoke({ token: state.inputs.restSmokeToken });
          return { status: result.status, mode: "jev_audit_rest_recovery_smoke" };
        },
      });
    }

    return {
      jevAuditMcpRecovery: state.jevAuditMcpRecovery,
      jevAuditPrivateRecovery: state.jevAuditPrivateRecovery,
    };
  }

  function metadata() {
    return {
      previousJevAuditPrivateVersionId: state.previousJevAuditPrivateVersionId,
      previousJevAuditMcpVersionId: state.previousJevAuditMcpVersionId,
      jevAuditPrivateDeployment: state.jevAuditPrivateDeployment,
      jevAuditMcpDeployment: state.jevAuditMcpDeployment,
      ...buildJevAuditReleaseMetadata({
        privateVersionId: state.jevAuditPrivateVersionId,
        previousPrivateVersionId: state.previousJevAuditPrivateVersionId,
        mcpVersionId: state.jevAuditMcpVersionId,
        previousMcpVersionId: state.previousJevAuditMcpVersionId,
        restSmoke: state.jevAuditRestSmoke,
        mcpSmoke: state.jevAuditMcpSmoke,
        privateRecovery: state.jevAuditPrivateRecovery,
        mcpRecovery: state.jevAuditMcpRecovery,
      }),
    };
  }

  return { prepare, deploy, smoke, recover, metadata };
}
