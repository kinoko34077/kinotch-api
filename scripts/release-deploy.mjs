export async function deployWithReconciliation({
  deploy,
  parseVersionId,
  getActiveVersionId,
  previousVersionId = null,
} = {}) {
  if (typeof deploy !== "function") throw new TypeError("deploy must be a function");
  if (typeof parseVersionId !== "function") throw new TypeError("parseVersionId must be a function");
  if (typeof getActiveVersionId !== "function") throw new TypeError("getActiveVersionId must be a function");

  try {
    const output = await deploy();
    return {
      status: "deployed",
      versionId: parseVersionId(output),
      deployed: true,
      needsRollback: false,
    };
  } catch (error) {
    try {
      const activeVersionId = await getActiveVersionId();
      if (activeVersionId && activeVersionId !== previousVersionId) {
        return {
          status: "remote_changed_after_failure",
          versionId: activeVersionId,
          deployed: true,
          needsRollback: previousVersionId !== null,
          error,
        };
      }
      return {
        status: "deploy_failed",
        versionId: null,
        deployed: false,
        needsRollback: false,
        error,
      };
    } catch (reconciliationError) {
      return {
        status: "reconciliation_failed",
        versionId: null,
        deployed: previousVersionId !== null,
        needsRollback: previousVersionId !== null,
        error,
        reconciliationError,
      };
    }
  }
}
