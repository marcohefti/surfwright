import process from "node:process";
import { sessionParkIdleManagedProcesses } from "./session-idle-parking.js";
import {
  DEFAULT_DISK_PRUNE_CAPTURES_MAX_AGE_HOURS,
  DEFAULT_DISK_PRUNE_CAPTURES_MAX_TOTAL_BYTES,
  DEFAULT_DISK_PRUNE_ORPHAN_PROFILES_MAX_AGE_HOURS,
  DEFAULT_DISK_PRUNE_RUNS_MAX_AGE_HOURS,
  DEFAULT_DISK_PRUNE_RUNS_MAX_TOTAL_BYTES,
  stateDiskPrune,
} from "./disk-prune.js";
import { stateRootDir } from "./state-store.js";
import { providers } from "../../providers/index.js";

const DEFAULT_GC_MIN_INTERVAL_MS = 10 * 60 * 1000;
const MIN_GC_MIN_INTERVAL_MS = 1_000;
const MAX_GC_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_IDLE_PROCESS_TTL_MS = 30 * 60 * 1000;
const MIN_IDLE_PROCESS_TTL_MS = 60 * 1000;
const MAX_IDLE_PROCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_IDLE_PROCESS_SWEEP_CAP = 6;
const MIN_IDLE_PROCESS_SWEEP_CAP = 1;
const MAX_IDLE_PROCESS_SWEEP_CAP = 200;
const MIN_DISK_MAX_AGE_HOURS = 1;
const MAX_DISK_MAX_AGE_HOURS = 24 * 365 * 5;
const MIN_DISK_MAX_TOTAL_MB = 1;
const MAX_DISK_MAX_TOTAL_MB = 1024 * 1024;
const KICK_LOCK_STALE_MS = 30 * 1000;
const KICK_STAMP_FILE = "opportunistic-gc.stamp";
const KICK_LOCK_FILE = "opportunistic-gc.lock";

function parseBooleanEnabled(raw: string | undefined): boolean {
  if (typeof raw !== "string") {
    return true;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no") {
    return false;
  }
  return true;
}

function parseIntWithinBounds(input: {
  raw: string | undefined;
  fallback: number;
  min: number;
  max: number;
}): number {
  if (typeof input.raw !== "string" || input.raw.trim().length === 0) {
    return input.fallback;
  }
  const parsed = Number.parseInt(input.raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < input.min || parsed > input.max) {
    return input.fallback;
  }
  return parsed;
}

function parseOptionalIntWithinBounds(input: {
  raw: string | undefined;
  fallback: number | null;
  min: number;
  max: number;
}): number | null {
  if (typeof input.raw !== "string" || input.raw.trim().length === 0) {
    return input.fallback;
  }
  const normalized = input.raw.trim().toLowerCase();
  if (normalized === "off" || normalized === "none" || normalized === "null" || normalized === "0") {
    return null;
  }
  const parsed = Number.parseInt(input.raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < input.min || parsed > input.max) {
    return input.fallback;
  }
  return parsed;
}

function gcEnabled(): boolean {
  return parseBooleanEnabled(providers().env.get("SURFWRIGHT_GC_ENABLED"));
}

function gcMinIntervalMs(): number {
  return parseIntWithinBounds({
    raw: providers().env.get("SURFWRIGHT_GC_MIN_INTERVAL_MS"),
    fallback: DEFAULT_GC_MIN_INTERVAL_MS,
    min: MIN_GC_MIN_INTERVAL_MS,
    max: MAX_GC_MIN_INTERVAL_MS,
  });
}

function idleProcessTtlMs(): number {
  return parseIntWithinBounds({
    raw: providers().env.get("SURFWRIGHT_IDLE_PROCESS_TTL_MS"),
    fallback: DEFAULT_IDLE_PROCESS_TTL_MS,
    min: MIN_IDLE_PROCESS_TTL_MS,
    max: MAX_IDLE_PROCESS_TTL_MS,
  });
}

function idleProcessSweepCap(): number {
  return parseIntWithinBounds({
    raw: providers().env.get("SURFWRIGHT_IDLE_PROCESS_SWEEP_CAP"),
    fallback: DEFAULT_IDLE_PROCESS_SWEEP_CAP,
    min: MIN_IDLE_PROCESS_SWEEP_CAP,
    max: MAX_IDLE_PROCESS_SWEEP_CAP,
  });
}

function diskPruneEnabled(): boolean {
  return parseBooleanEnabled(providers().env.get("SURFWRIGHT_GC_DISK_PRUNE_ENABLED"));
}

function diskRunsMaxAgeHours(): number {
  return parseIntWithinBounds({
    raw: providers().env.get("SURFWRIGHT_GC_RUNS_MAX_AGE_HOURS"),
    fallback: DEFAULT_DISK_PRUNE_RUNS_MAX_AGE_HOURS,
    min: MIN_DISK_MAX_AGE_HOURS,
    max: MAX_DISK_MAX_AGE_HOURS,
  });
}

function diskRunsMaxTotalBytes(): number {
  const mb = parseIntWithinBounds({
    raw: providers().env.get("SURFWRIGHT_GC_RUNS_MAX_TOTAL_MB"),
    fallback: Math.floor(DEFAULT_DISK_PRUNE_RUNS_MAX_TOTAL_BYTES / (1024 * 1024)),
    min: MIN_DISK_MAX_TOTAL_MB,
    max: MAX_DISK_MAX_TOTAL_MB,
  });
  return mb * 1024 * 1024;
}

function diskCapturesMaxAgeHours(): number {
  return parseIntWithinBounds({
    raw: providers().env.get("SURFWRIGHT_GC_CAPTURES_MAX_AGE_HOURS"),
    fallback: DEFAULT_DISK_PRUNE_CAPTURES_MAX_AGE_HOURS,
    min: MIN_DISK_MAX_AGE_HOURS,
    max: MAX_DISK_MAX_AGE_HOURS,
  });
}

function diskCapturesMaxTotalBytes(): number {
  const mb = parseIntWithinBounds({
    raw: providers().env.get("SURFWRIGHT_GC_CAPTURES_MAX_TOTAL_MB"),
    fallback: Math.floor(DEFAULT_DISK_PRUNE_CAPTURES_MAX_TOTAL_BYTES / (1024 * 1024)),
    min: MIN_DISK_MAX_TOTAL_MB,
    max: MAX_DISK_MAX_TOTAL_MB,
  });
  return mb * 1024 * 1024;
}

function diskOrphanProfilesMaxAgeHours(): number {
  return parseIntWithinBounds({
    raw: providers().env.get("SURFWRIGHT_GC_ORPHAN_PROFILES_MAX_AGE_HOURS"),
    fallback: DEFAULT_DISK_PRUNE_ORPHAN_PROFILES_MAX_AGE_HOURS,
    min: MIN_DISK_MAX_AGE_HOURS,
    max: MAX_DISK_MAX_AGE_HOURS,
  });
}

function diskWorkspaceProfilesMaxAgeHours(): number | null {
  return parseOptionalIntWithinBounds({
    raw: providers().env.get("SURFWRIGHT_GC_WORKSPACE_PROFILES_MAX_AGE_HOURS"),
    fallback: null,
    min: MIN_DISK_MAX_AGE_HOURS,
    max: MAX_DISK_MAX_AGE_HOURS,
  });
}

function kickStampPath(): string {
  return providers().path.join(stateRootDir(), KICK_STAMP_FILE);
}

function kickLockPath(): string {
  return providers().path.join(stateRootDir(), KICK_LOCK_FILE);
}

function withKickLock<T>(fn: () => T): T | null {
  const { fs } = providers();
  const root = stateRootDir();
  const lockPath = kickLockPath();
  fs.mkdirSync(root, { recursive: true });

  let acquired = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      acquired = true;
      break;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") {
        return null;
      }
      try {
        const stat = fs.statSync(lockPath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (Number.isFinite(ageMs) && ageMs > KICK_LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // If stat/unlink fails, treat lock as held.
      }
      return null;
    }
  }

  if (!acquired) {
    return null;
  }

  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // ignore
    }
  }
}

function reserveKickSlot(): boolean {
  const intervalMs = gcMinIntervalMs();
  const { fs } = providers();
  return (
    withKickLock(() => {
      const stampPath = kickStampPath();
      const nowMs = Date.now();
      try {
        const stat = fs.statSync(stampPath);
        const ageMs = nowMs - stat.mtimeMs;
        if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < intervalMs) {
          return false;
        }
      } catch {
        // missing/unreadable stamp means we can reserve a slot
      }

      fs.writeFileSync(stampPath, `${JSON.stringify({ triggeredAt: new Date(nowMs).toISOString() })}\n`, "utf8");
      return true;
    }) ?? false
  );
}

export function kickOpportunisticStateMaintenance(entryScriptPath: string): boolean {
  if (!gcEnabled()) {
    return false;
  }
  if (typeof entryScriptPath !== "string" || entryScriptPath.length === 0) {
    return false;
  }
  if (providers().env.get("SURFWRIGHT_MAINTENANCE_CHILD") === "1") {
    return false;
  }
  if (!reserveKickSlot()) {
    return false;
  }

  try {
    const { childProcess, env, runtime } = providers();
    const child = childProcess.spawn(runtime.execPath, [entryScriptPath, "__maintenance-worker"], {
      detached: true,
      stdio: "ignore",
      env: {
        ...env.snapshot(),
        SURFWRIGHT_MAINTENANCE_CHILD: "1",
      },
    });
    child.unref();
    return typeof child.pid === "number" && child.pid > 0;
  } catch {
    return false;
  }
}

export async function runOpportunisticStateMaintenanceWorker(): Promise<void> {
  if (!gcEnabled()) {
    return;
  }
  try {
    await sessionParkIdleManagedProcesses({
      idleTtlMs: idleProcessTtlMs(),
      sweepCap: idleProcessSweepCap(),
    });
  } catch {
    // best effort; maintenance failures should not crash caller flows
  }

  if (!diskPruneEnabled()) {
    return;
  }

  try {
    await stateDiskPrune({
      runsMaxAgeHours: diskRunsMaxAgeHours(),
      runsMaxTotalBytes: diskRunsMaxTotalBytes(),
      capturesMaxAgeHours: diskCapturesMaxAgeHours(),
      capturesMaxTotalBytes: diskCapturesMaxTotalBytes(),
      orphanProfilesMaxAgeHours: diskOrphanProfilesMaxAgeHours(),
      workspaceProfilesMaxAgeHours: diskWorkspaceProfilesMaxAgeHours(),
      dryRun: false,
    });
  } catch {
    // best effort; maintenance failures should not crash caller flows
  }
}
