export * from "./app/index.js";
export * from "./repo/index.js";

// Internal core consumers should import state utilities from this entrypoint.
export {
  defaultSessionUserDataDir,
  inferDebugPortFromCdpOrigin,
  nowIso,
  readState,
  sanitizeSessionId,
  stateFilePath,
  stateRootDir,
} from "./infra/state-store.js";

export { assertSessionDoesNotExist } from "./infra/state-store.js";

export { pruneNetworkArtifacts } from "./infra/network-artifact-service.js";
export { sessionClear, sessionPrune, stateReconcile, targetPrune } from "./infra/maintenance.js";
export { kickOpportunisticStateMaintenance, runOpportunisticStateMaintenanceWorker } from "./infra/opportunistic-maintenance.js";
