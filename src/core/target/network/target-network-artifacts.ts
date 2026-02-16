import {
  appendNetworkArtifact,
  listNetworkArtifacts,
  pruneNetworkArtifacts,
} from "../../state/index.js";
import type {
  TargetNetworkArtifactListReport,
  TargetNetworkArtifactPruneReport,
  TargetNetworkExportReport,
} from "../../types.js";

export async function recordNetworkArtifact(opts: {
  report: TargetNetworkExportReport;
  captureId: string | null;
}) {
  await appendNetworkArtifact(opts);
}

export function targetNetworkArtifactList(opts: { limit?: number }): TargetNetworkArtifactListReport {
  const list = listNetworkArtifacts(opts);
  return {
    ok: true,
    total: list.total,
    returned: list.returned,
    artifacts: list.artifacts,
  };
}

export async function targetNetworkArtifactPrune(opts: {
  maxAgeHours?: number;
  maxCount?: number;
  maxTotalBytes?: number;
  deleteFiles?: boolean;
}): Promise<TargetNetworkArtifactPruneReport> {
  return await pruneNetworkArtifacts(opts);
}
