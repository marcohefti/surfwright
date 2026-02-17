import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { WorkspaceProfileLockClearReport, WorkspaceProfileLocksReport } from "../../types.js";
import { workspaceProfileSessionsDir } from "./workspace.js";

const PROFILE_LOCK_STALE_MS = 20000;

function isProcessAlive(pid: number): boolean {
  if (pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLock(lockPath: string): { pid: number | null; ts: number | null } {
  try {
    const raw = fs.readFileSync(lockPath, "utf8").trim();
    const [pidRaw, tsRaw] = raw.split(/\s+/, 2);
    const pid = pidRaw ? Number.parseInt(pidRaw, 10) : NaN;
    const ts = tsRaw ? Number.parseInt(tsRaw, 10) : NaN;
    return {
      pid: Number.isFinite(pid) && pid > 0 ? pid : null,
      ts: Number.isFinite(ts) && ts > 0 ? ts : null,
    };
  } catch {
    return { pid: null, ts: null };
  }
}

export function workspaceProfileLocksForDir(opts: {
  workspaceDir: string;
}): Pick<WorkspaceProfileLocksReport, "profileSessionsDir" | "locks" | "hint"> {
  const dir = workspaceProfileSessionsDir(opts.workspaceDir);

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    entries = [];
  }

  const locks: WorkspaceProfileLocksReport["locks"] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".lock")) {
      continue;
    }
    const profile = entry.slice(0, -".lock".length);
    const lockPath = path.join(dir, entry);
    const parsed = readLock(lockPath);
    const ageMs = parsed.ts ? Math.max(0, Date.now() - parsed.ts) : null;
    const pidAlive = parsed.pid ? isProcessAlive(parsed.pid) : null;
    const stale = ageMs !== null && ageMs > PROFILE_LOCK_STALE_MS && (pidAlive === false || pidAlive === null);
    locks.push({
      profile,
      path: lockPath,
      pid: parsed.pid,
      ageMs,
      pidAlive,
      stale,
    });
  }

  locks.sort((a, b) => a.profile.localeCompare(b.profile));
  return {
    profileSessionsDir: dir,
    locks,
    hint: locks.length > 0 ? "Use 'surfwright workspace profile-lock-clear <profile>' to clear stale locks." : null,
  };
}

export function workspaceProfileLockClearForDir(opts: {
  workspaceDir: string;
  profile: string;
  force?: boolean;
}): Pick<WorkspaceProfileLockClearReport, "cleared" | "path" | "reason" | "hint"> {
  const dir = workspaceProfileSessionsDir(opts.workspaceDir);
  const lockPath = path.join(dir, `${opts.profile}.lock`);

  if (!fs.existsSync(lockPath)) {
    return {
      cleared: false,
      path: lockPath,
      reason: "not_found",
      hint: null,
    };
  }

  const parsed = readLock(lockPath);
  const ageMs = parsed.ts ? Math.max(0, Date.now() - parsed.ts) : null;
  const pidAlive = parsed.pid ? isProcessAlive(parsed.pid) : null;
  const stale = ageMs !== null && ageMs > PROFILE_LOCK_STALE_MS && (pidAlive === false || pidAlive === null);

  if (opts.force) {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // ignore
    }
    return {
      cleared: true,
      path: lockPath,
      reason: "forced",
      hint: null,
    };
  }

  if (!stale) {
    return {
      cleared: false,
      path: lockPath,
      reason: "active",
      hint: "Lock does not look stale. Use --force to clear anyway.",
    };
  }

  try {
    fs.unlinkSync(lockPath);
  } catch {
    // ignore
  }
  return {
    cleared: true,
    path: lockPath,
    reason: "cleared",
    hint: null,
  };
}

