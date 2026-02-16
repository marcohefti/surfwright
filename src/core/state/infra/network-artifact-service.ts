import { providers } from "../../providers/index.js";
import type { TargetNetworkArtifactPruneReport } from "../../types.js";
import { readState } from "./state-store.js";
import { pruneNetworkArtifactsInState } from "../repo/network-artifact-repo.js";

export async function pruneNetworkArtifacts(opts: {
  maxAgeHours?: number;
  maxCount?: number;
  maxTotalBytes?: number;
  deleteFiles?: boolean;
}): Promise<TargetNetworkArtifactPruneReport> {
  const { fs } = providers();
  const snapshot = readState();

  const missingPaths: string[] = [];
  for (const artifact of Object.values(snapshot.networkArtifacts)) {
    try {
      if (!fs.existsSync(artifact.path)) {
        missingPaths.push(artifact.path);
      }
    } catch {
      // If path checks throw, treat it as missing; state pruning is authoritative.
      missingPaths.push(artifact.path);
    }
  }

  const deleteFiles = opts.deleteFiles !== false;
  const { report, removedPaths } = await pruneNetworkArtifactsInState({
    maxAgeHours: opts.maxAgeHours,
    maxCount: opts.maxCount,
    maxTotalBytes: opts.maxTotalBytes,
    deleteFiles,
    missingPaths,
  });

  if (deleteFiles) {
    for (const artifactPath of removedPaths) {
      try {
        fs.rmSync(artifactPath, { force: true });
      } catch {
        // best effort; state pruning is authoritative
      }
    }
  }

  return report;
}

