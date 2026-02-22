import type { Stats } from "node:fs";
import { CliError } from "../../errors.js";
import { providers } from "../../providers/index.js";
import type { SessionState, StateDiskPruneReport } from "../../types.js";
import { resolveWorkspaceDir, workspaceProfilesDir } from "../../workspace/index.js";
import { readState, stateRootDir } from "./state-store.js";

const HOURS_TO_MS = 60 * 60 * 1000;
const MB_TO_BYTES = 1024 * 1024;

const MIN_MAX_AGE_HOURS = 1;
const MAX_MAX_AGE_HOURS = 24 * 365 * 5;
const MIN_MAX_TOTAL_BYTES = 1 * MB_TO_BYTES;
const MAX_MAX_TOTAL_BYTES = 1024 * 1024 * MB_TO_BYTES;

export const DEFAULT_DISK_PRUNE_RUNS_MAX_AGE_HOURS = 24 * 7;
export const DEFAULT_DISK_PRUNE_RUNS_MAX_TOTAL_BYTES = 1024 * MB_TO_BYTES;
export const DEFAULT_DISK_PRUNE_CAPTURES_MAX_AGE_HOURS = 24 * 3;
export const DEFAULT_DISK_PRUNE_CAPTURES_MAX_TOTAL_BYTES = 1024 * MB_TO_BYTES;
export const DEFAULT_DISK_PRUNE_ORPHAN_PROFILES_MAX_AGE_HOURS = 24;

export type StateDiskPruneOptions = {
  runsMaxAgeHours?: number;
  runsMaxTotalBytes?: number;
  capturesMaxAgeHours?: number;
  capturesMaxTotalBytes?: number;
  orphanProfilesMaxAgeHours?: number;
  workspaceProfilesMaxAgeHours?: number | null;
  dryRun?: boolean;
};

type DiskEntry = {
  name: string;
  path: string;
  mtimeMs: number;
  bytes: number;
};

type ParsedDiskPruneOptions = {
  runsMaxAgeHours: number | null;
  runsMaxTotalBytes: number | null;
  capturesMaxAgeHours: number | null;
  capturesMaxTotalBytes: number | null;
  orphanProfilesMaxAgeHours: number | null;
  workspaceProfilesMaxAgeHours: number | null;
  dryRun: boolean;
};

function parseOptionalRetentionNumber(opts: {
  value: number | null | undefined;
  name: string;
  min: number;
  max: number;
  fallback: number | null;
}): number | null {
  if (typeof opts.value === "undefined") {
    return opts.fallback;
  }
  if (opts.value === null) {
    return null;
  }
  if (!Number.isFinite(opts.value) || !Number.isInteger(opts.value) || opts.value < opts.min || opts.value > opts.max) {
    throw new CliError("E_QUERY_INVALID", `${opts.name} must be an integer between ${opts.min} and ${opts.max}`);
  }
  return opts.value;
}

function parseDiskPruneOptions(opts: StateDiskPruneOptions): ParsedDiskPruneOptions {
  return {
    runsMaxAgeHours: parseOptionalRetentionNumber({
      value: opts.runsMaxAgeHours,
      name: "runs-max-age-hours",
      min: MIN_MAX_AGE_HOURS,
      max: MAX_MAX_AGE_HOURS,
      fallback: DEFAULT_DISK_PRUNE_RUNS_MAX_AGE_HOURS,
    }),
    runsMaxTotalBytes: parseOptionalRetentionNumber({
      value: opts.runsMaxTotalBytes,
      name: "runs-max-total-bytes",
      min: MIN_MAX_TOTAL_BYTES,
      max: MAX_MAX_TOTAL_BYTES,
      fallback: DEFAULT_DISK_PRUNE_RUNS_MAX_TOTAL_BYTES,
    }),
    capturesMaxAgeHours: parseOptionalRetentionNumber({
      value: opts.capturesMaxAgeHours,
      name: "captures-max-age-hours",
      min: MIN_MAX_AGE_HOURS,
      max: MAX_MAX_AGE_HOURS,
      fallback: DEFAULT_DISK_PRUNE_CAPTURES_MAX_AGE_HOURS,
    }),
    capturesMaxTotalBytes: parseOptionalRetentionNumber({
      value: opts.capturesMaxTotalBytes,
      name: "captures-max-total-bytes",
      min: MIN_MAX_TOTAL_BYTES,
      max: MAX_MAX_TOTAL_BYTES,
      fallback: DEFAULT_DISK_PRUNE_CAPTURES_MAX_TOTAL_BYTES,
    }),
    orphanProfilesMaxAgeHours: parseOptionalRetentionNumber({
      value: opts.orphanProfilesMaxAgeHours,
      name: "orphan-profiles-max-age-hours",
      min: MIN_MAX_AGE_HOURS,
      max: MAX_MAX_AGE_HOURS,
      fallback: DEFAULT_DISK_PRUNE_ORPHAN_PROFILES_MAX_AGE_HOURS,
    }),
    workspaceProfilesMaxAgeHours: parseOptionalRetentionNumber({
      value: opts.workspaceProfilesMaxAgeHours,
      name: "workspace-profiles-max-age-hours",
      min: MIN_MAX_AGE_HOURS,
      max: MAX_MAX_AGE_HOURS,
      fallback: null,
    }),
    dryRun: Boolean(opts.dryRun),
  };
}

function listDirectoryEntries(dirPath: string): DiskEntry[] {
  const { fs, path } = providers();
  let names: string[];
  try {
    names = fs.readdirSync(dirPath).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }

  const entries: DiskEntry[] = [];
  for (const name of names) {
    const entryPath = path.join(dirPath, name);
    const stat = safeStat(entryPath);
    if (!stat) {
      continue;
    }
    entries.push({
      name,
      path: entryPath,
      mtimeMs: stat.mtimeMs,
      bytes: collectPathBytes(entryPath),
    });
  }
  return entries;
}

function safeStat(entryPath: string): Stats | null {
  const { fs } = providers();
  try {
    return fs.statSync(entryPath);
  } catch {
    return null;
  }
}

function collectPathBytes(entryPath: string): number {
  const { fs, path } = providers();
  const stat = safeStat(entryPath);
  if (!stat) {
    return 0;
  }
  if (!stat.isDirectory()) {
    return Math.max(0, Math.floor(stat.size));
  }

  let total = 0;
  let names: string[];
  try {
    names = fs.readdirSync(entryPath);
  } catch {
    return 0;
  }

  for (const name of names) {
    total += collectPathBytes(path.join(entryPath, name));
  }
  return total;
}

function removePath(entryPath: string, dryRun: boolean): void {
  if (dryRun) {
    return;
  }
  try {
    providers().fs.rmSync(entryPath, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

function pickEntriesToRemove(opts: {
  entries: DiskEntry[];
  maxAgeHours: number | null;
  maxTotalBytes: number | null;
}): Set<string> {
  const sorted = [...opts.entries].sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) {
      return b.mtimeMs - a.mtimeMs;
    }
    return a.name.localeCompare(b.name);
  });

  const removePaths = new Set<string>();
  if (opts.maxAgeHours !== null) {
    const cutoffMs = Date.now() - opts.maxAgeHours * HOURS_TO_MS;
    for (const entry of sorted) {
      if (Number.isFinite(entry.mtimeMs) && entry.mtimeMs < cutoffMs) {
        removePaths.add(entry.path);
      }
    }
  }

  if (opts.maxTotalBytes !== null) {
    let runningBytes = 0;
    for (const entry of sorted) {
      if (removePaths.has(entry.path)) {
        continue;
      }
      const nextTotal = runningBytes + Math.max(0, entry.bytes);
      if (nextTotal > opts.maxTotalBytes) {
        removePaths.add(entry.path);
        continue;
      }
      runningBytes = nextTotal;
    }
  }

  return removePaths;
}

function pruneDirectoryByAgeAndSize(opts: {
  dirPath: string;
  maxAgeHours: number | null;
  maxTotalBytes: number | null;
  dryRun: boolean;
}): {
  scanned: number;
  removed: number;
  bytesBefore: number;
  bytesAfter: number;
  bytesFreed: number;
} {
  const entries = listDirectoryEntries(opts.dirPath);
  const removePaths = pickEntriesToRemove({
    entries,
    maxAgeHours: opts.maxAgeHours,
    maxTotalBytes: opts.maxTotalBytes,
  });

  for (const entryPath of removePaths) {
    removePath(entryPath, opts.dryRun);
  }

  const bytesBefore = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const bytesAfter = entries.filter((entry) => !removePaths.has(entry.path)).reduce((sum, entry) => sum + entry.bytes, 0);

  return {
    scanned: entries.length,
    removed: removePaths.size,
    bytesBefore,
    bytesAfter,
    bytesFreed: Math.max(0, bytesBefore - bytesAfter),
  };
}

function managedSessionUsesPath(session: SessionState | undefined, profilePath: string): boolean {
  if (!session || session.kind !== "managed") {
    return false;
  }
  const userDataDir = typeof session.userDataDir === "string" && session.userDataDir.length > 0 ? session.userDataDir : null;
  if (!userDataDir) {
    return false;
  }
  const resolvedSessionPath = providers().path.resolve(userDataDir);
  const resolvedProfilePath = providers().path.resolve(profilePath);
  return resolvedSessionPath === resolvedProfilePath;
}

function pruneOrphanProfiles(opts: {
  profilesDir: string;
  sessionsById: Record<string, SessionState>;
  maxAgeHours: number | null;
  dryRun: boolean;
}): {
  scanned: number;
  removed: number;
  bytesBefore: number;
  bytesAfter: number;
  bytesFreed: number;
} {
  const entries = listDirectoryEntries(opts.profilesDir);
  const removePaths = new Set<string>();
  const cutoffMs = opts.maxAgeHours === null ? null : Date.now() - opts.maxAgeHours * HOURS_TO_MS;

  for (const entry of entries) {
    const session = opts.sessionsById[entry.name];
    if (managedSessionUsesPath(session, entry.path)) {
      continue;
    }
    if (cutoffMs !== null && Number.isFinite(entry.mtimeMs) && entry.mtimeMs >= cutoffMs) {
      continue;
    }
    removePaths.add(entry.path);
  }

  for (const entryPath of removePaths) {
    removePath(entryPath, opts.dryRun);
  }

  const bytesBefore = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const bytesAfter = entries.filter((entry) => !removePaths.has(entry.path)).reduce((sum, entry) => sum + entry.bytes, 0);

  return {
    scanned: entries.length,
    removed: removePaths.size,
    bytesBefore,
    bytesAfter,
    bytesFreed: Math.max(0, bytesBefore - bytesAfter),
  };
}

export async function stateDiskPrune(opts: StateDiskPruneOptions = {}): Promise<StateDiskPruneReport> {
  const parsed = parseDiskPruneOptions(opts);
  const { path } = providers();
  const snapshot = readState();
  const root = stateRootDir();

  const runs = pruneDirectoryByAgeAndSize({
    dirPath: path.join(root, "runs"),
    maxAgeHours: parsed.runsMaxAgeHours,
    maxTotalBytes: parsed.runsMaxTotalBytes,
    dryRun: parsed.dryRun,
  });
  const captures = pruneDirectoryByAgeAndSize({
    dirPath: path.join(root, "captures"),
    maxAgeHours: parsed.capturesMaxAgeHours,
    maxTotalBytes: parsed.capturesMaxTotalBytes,
    dryRun: parsed.dryRun,
  });
  const orphanProfiles = pruneOrphanProfiles({
    profilesDir: path.join(root, "profiles"),
    sessionsById: snapshot.sessions,
    maxAgeHours: parsed.orphanProfilesMaxAgeHours,
    dryRun: parsed.dryRun,
  });

  const resolvedWorkspaceDir = resolveWorkspaceDir();
  const workspacePruneEnabled = parsed.workspaceProfilesMaxAgeHours !== null && resolvedWorkspaceDir !== null;
  const workspaceProfiles = workspacePruneEnabled
    ? pruneOrphanProfiles({
        profilesDir: workspaceProfilesDir(resolvedWorkspaceDir),
        sessionsById: snapshot.sessions,
        maxAgeHours: parsed.workspaceProfilesMaxAgeHours,
        dryRun: parsed.dryRun,
      })
    : {
        scanned: 0,
        removed: 0,
        bytesBefore: 0,
        bytesAfter: 0,
        bytesFreed: 0,
      };

  const totalBytesBefore = runs.bytesBefore + captures.bytesBefore + orphanProfiles.bytesBefore + workspaceProfiles.bytesBefore;
  const totalBytesAfter = runs.bytesAfter + captures.bytesAfter + orphanProfiles.bytesAfter + workspaceProfiles.bytesAfter;

  return {
    ok: true,
    stateRootDir: root,
    dryRun: parsed.dryRun,
    totalBytesBefore,
    totalBytesAfter,
    totalBytesFreed: Math.max(0, totalBytesBefore - totalBytesAfter),
    runs: {
      ...runs,
      maxAgeHours: parsed.runsMaxAgeHours,
      maxTotalBytes: parsed.runsMaxTotalBytes,
    },
    captures: {
      ...captures,
      maxAgeHours: parsed.capturesMaxAgeHours,
      maxTotalBytes: parsed.capturesMaxTotalBytes,
    },
    orphanProfiles: {
      ...orphanProfiles,
      maxAgeHours: parsed.orphanProfilesMaxAgeHours,
      maxTotalBytes: null,
    },
    workspaceProfiles: {
      ...workspaceProfiles,
      enabled: workspacePruneEnabled,
      workspaceDir: resolvedWorkspaceDir,
      maxAgeHours: parsed.workspaceProfilesMaxAgeHours,
      maxTotalBytes: null,
    },
  };
}
