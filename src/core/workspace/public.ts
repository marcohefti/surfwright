import type { WorkspaceInfoReport, WorkspaceInitReport, WorkspaceProfileLockClearReport, WorkspaceProfileLocksReport } from "../types.js";
import { initWorkspaceInRepoDir, resolveRepoDirForWorkspaceInit, resolveWorkspaceDir, workspaceProfilesDir, workspaceProfileSessionsDir } from "./infra/workspace.js";
import { sanitizeProfileName } from "../profile/index.js";
import { workspaceProfileLockClearForDir, workspaceProfileLocksForDir } from "./infra/profile-locks.js";

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
  const cwd = resolveRepoDirForWorkspaceInit(opts);
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
  const report = workspaceProfileLocksForDir({ workspaceDir });
  return {
    ok: true,
    found: true,
    workspaceDir,
    profileSessionsDir: report.profileSessionsDir,
    locks: report.locks,
    hint: report.hint,
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
  const report = workspaceProfileLockClearForDir({ workspaceDir, profile, force: opts.force });
  return {
    ok: true,
    found: true,
    profile,
    cleared: report.cleared,
    path: report.path,
    reason: report.reason,
    hint: report.hint,
  };
}
