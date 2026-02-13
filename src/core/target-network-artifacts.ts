import fs from "node:fs";
import { CliError } from "./errors.js";
import { allocateArtifactId, readState, updateState } from "./state.js";
import type {
  TargetNetworkArtifactListReport,
  TargetNetworkArtifactPruneReport,
  TargetNetworkExportReport,
} from "./types.js";

function parseLimit(input: number | undefined): number {
  if (typeof input === "undefined") {
    return 50;
  }
  if (!Number.isFinite(input) || !Number.isInteger(input) || input < 1 || input > 5000) {
    throw new CliError("E_QUERY_INVALID", "limit must be an integer between 1 and 5000");
  }
  return input;
}

function parseOptionalRange(opts: {
  value: number | undefined;
  name: string;
  min: number;
  max: number;
}): number | null {
  if (typeof opts.value === "undefined") {
    return null;
  }
  if (!Number.isFinite(opts.value) || !Number.isInteger(opts.value) || opts.value < opts.min || opts.value > opts.max) {
    throw new CliError("E_QUERY_INVALID", `${opts.name} must be an integer between ${opts.min} and ${opts.max}`);
  }
  return opts.value;
}

export async function recordNetworkArtifact(opts: {
  report: TargetNetworkExportReport;
  captureId: string | null;
}) {
  await updateState(async (state) => {
    const artifactId = allocateArtifactId(state);
    state.networkArtifacts[artifactId] = {
      artifactId,
      createdAt: opts.report.artifact.writtenAt,
      format: "har",
      path: opts.report.artifact.path,
      sessionId: opts.report.sessionId,
      targetId: opts.report.targetId,
      captureId: opts.captureId,
      entries: opts.report.artifact.entries,
      bytes: opts.report.artifact.bytes,
    };
  });
}

export function targetNetworkArtifactList(opts: { limit?: number }): TargetNetworkArtifactListReport {
  const parsedLimit = parseLimit(opts.limit);
  const state = readState();
  const artifacts = Object.values(state.networkArtifacts)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, parsedLimit);
  return {
    ok: true,
    total: Object.keys(state.networkArtifacts).length,
    returned: artifacts.length,
    artifacts,
  };
}

export async function targetNetworkArtifactPrune(opts: {
  maxAgeHours?: number;
  maxCount?: number;
  maxTotalBytes?: number;
  deleteFiles?: boolean;
}): Promise<TargetNetworkArtifactPruneReport> {
  const maxAgeHours = parseOptionalRange({
    value: opts.maxAgeHours,
    name: "max-age-hours",
    min: 1,
    max: 8760,
  });
  const maxCount = parseOptionalRange({
    value: opts.maxCount,
    name: "max-count",
    min: 1,
    max: 10000,
  });
  const maxTotalBytes = parseOptionalRange({
    value: opts.maxTotalBytes,
    name: "max-total-bytes",
    min: 1,
    max: 100_000_000_000,
  });
  const deleteFiles = opts.deleteFiles !== false;
  const result = await updateState((state) => {
    const entries = Object.values(state.networkArtifacts).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const cutoffMs = maxAgeHours === null ? null : Date.now() - maxAgeHours * 60 * 60 * 1000;
    const removeIds = new Set<string>();
    let removedMissingFiles = 0;
    let removedByAge = 0;
    let removedByCount = 0;
    let removedBySize = 0;

    for (const artifact of entries) {
      if (!fs.existsSync(artifact.path)) {
        removeIds.add(artifact.artifactId);
        removedMissingFiles += 1;
      }
    }

    const candidates = entries.filter((artifact) => !removeIds.has(artifact.artifactId));
    if (cutoffMs !== null) {
      for (const artifact of candidates) {
        const createdAtMs = Date.parse(artifact.createdAt);
        if (Number.isFinite(createdAtMs) && createdAtMs < cutoffMs) {
          removeIds.add(artifact.artifactId);
          removedByAge += 1;
        }
      }
    }

    const afterAge = candidates.filter((artifact) => !removeIds.has(artifact.artifactId));
    if (maxCount !== null && afterAge.length > maxCount) {
      for (const artifact of afterAge.slice(maxCount)) {
        removeIds.add(artifact.artifactId);
        removedByCount += 1;
      }
    }

    const afterCount = afterAge.filter((artifact) => !removeIds.has(artifact.artifactId));
    if (maxTotalBytes !== null) {
      let runningBytes = 0;
      for (const artifact of afterCount) {
        const nextBytes = runningBytes + Math.max(0, artifact.bytes);
        if (nextBytes > maxTotalBytes) {
          removeIds.add(artifact.artifactId);
          removedBySize += 1;
          continue;
        }
        runningBytes = nextBytes;
      }
    }

    const removedPaths: string[] = [];
    for (const artifactId of removeIds) {
      const existing = state.networkArtifacts[artifactId];
      if (!existing) {
        continue;
      }
      removedPaths.push(existing.path);
      delete state.networkArtifacts[artifactId];
    }

    return {
      totalBefore: entries.length,
      totalAfter: Object.keys(state.networkArtifacts).length,
      removedPaths,
      removedMissingFiles,
      removedByAge,
      removedByCount,
      removedBySize,
    };
  });

  if (deleteFiles) {
    for (const path of result.removedPaths) {
      try {
        fs.rmSync(path, { force: true });
      } catch {
        // best effort; state pruning is authoritative
      }
    }
  }

  return {
    ok: true,
    totalBefore: result.totalBefore,
    totalAfter: result.totalAfter,
    removed: result.totalBefore - result.totalAfter,
    removedMissingFiles: result.removedMissingFiles,
    removedByAge: result.removedByAge,
    removedByCount: result.removedByCount,
    removedBySize: result.removedBySize,
    maxAgeHours,
    maxCount,
    maxTotalBytes,
    deleteFiles,
  };
}
