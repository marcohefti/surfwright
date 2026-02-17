import path from "node:path";
import process from "node:process";

import type { WorkspaceInfoReport, WorkspaceInitReport } from "../types.js";
import { initWorkspaceInRepoDir, resolveWorkspaceDir, workspaceProfilesDir, workspaceProfileSessionsDir } from "./infra/workspace.js";

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
