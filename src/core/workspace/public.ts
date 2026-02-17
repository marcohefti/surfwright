import path from "node:path";
import process from "node:process";

import fs from "node:fs";

import type { WorkspaceInfoReport, WorkspaceInitReport, WorkspaceProfileLockClearReport, WorkspaceProfileLocksReport } from "../types.js";
import { initWorkspaceInRepoDir, resolveWorkspaceDir, workspaceProfilesDir, workspaceProfileSessionsDir } from "./infra/workspace.js";
import { sanitizeProfileName } from "../profile/index.js";

export function workspaceInfo(): WorkspaceInfoReport {
  const workspaceDir = resolveWorkspaceDir();
  if (!workspaceDir) {
    return {
      ok: true,
      found: false,
      workspaceDir: null,
      profilesDir: null,
      profileSessionsDir: null,
      hint: "Run 'surfwright workspace init' in your project root to create ./.surfwright/ (gitignored) for profiles.",
    };
  }
  return {
    ok: true,
    found: true,
    workspaceDir,
    profilesDir: workspaceProfilesDir(workspaceDir),
    profileSessionsDir: workspaceProfileSessionsDir(workspaceDir),
    hint: null,
  };
}

export function workspaceInit(opts?: { cwd?: string }): WorkspaceInitReport {
  const cwd = path.resolve(opts?.cwd ?? process.cwd());
  const created = initWorkspaceInRepoDir(cwd);
  return {
    ok: true,
    workspaceDir: created.workspaceDir,
    markerPath: created.markerPath,
    profilesDir: created.profilesDir,
    profileSessionsDir: created.profileSessionsDir,
    gitignore: created.gitignore,
  };
}

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

export function workspaceProfileLocks(): WorkspaceProfileLocksReport {
  const workspaceDir = resolveWorkspaceDir();
  if (!workspaceDir) {
    return {
      ok: true,
      found: false,
      workspaceDir: null,
      profileSessionsDir: null,
      locks: [],
      hint: "Run 'surfwright workspace init' in your project root to create ./.surfwright/ for profiles.",
    };
  }
  const dir = workspaceProfileSessionsDir(workspaceDir);
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
    ok: true,
    found: true,
    workspaceDir,
    profileSessionsDir: dir,
    locks,
    hint: locks.length > 0 ? "Use 'surfwright workspace profile-lock-clear <profile>' to clear stale locks." : null,
  };
}

export function workspaceProfileLockClear(opts: { profile: string; force?: boolean }): WorkspaceProfileLockClearReport {
  const workspaceDir = resolveWorkspaceDir();
  const profile = sanitizeProfileName(opts.profile);
  if (!workspaceDir) {
    return {
      ok: true,
      found: false,
      profile,
      cleared: false,
      path: null,
      reason: "not_found",
      hint: "Run 'surfwright workspace init' in your project root to create ./.surfwright/ for profiles.",
    };
  }
  const dir = workspaceProfileSessionsDir(workspaceDir);
  const lockPath = path.join(dir, `${profile}.lock`);
  if (!fs.existsSync(lockPath)) {
    return {
      ok: true,
      found: true,
      profile,
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
      ok: true,
      found: true,
      profile,
      cleared: true,
      path: lockPath,
      reason: "forced",
      hint: null,
    };
  }

  if (!stale) {
    return {
      ok: true,
      found: true,
      profile,
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
    ok: true,
    found: true,
    profile,
    cleared: true,
    path: lockPath,
    reason: "cleared",
    hint: null,
  };
}
