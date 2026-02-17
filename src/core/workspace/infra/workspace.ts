import fs from "node:fs";
import path from "node:path";

import { CliError } from "../../errors.js";
import { providers } from "../../providers/index.js";

export const WORKSPACE_VERSION = 1;
export const WORKSPACE_DIRNAME = ".surfwright";
export const WORKSPACE_MARKER_FILENAME = "workspace.json";
export const WORKSPACE_PROFILES_DIRNAME = "profiles";
export const WORKSPACE_PROFILE_SESSIONS_DIRNAME = "profile-sessions";

type WorkspaceMarker = {
  version: number;
  createdAt: string;
};

function workspaceMarkerPathForRepoDir(repoDir: string): string {
  return path.join(repoDir, WORKSPACE_DIRNAME, WORKSPACE_MARKER_FILENAME);
}

export function workspaceDirFromRepoDir(repoDir: string): string {
  return path.join(repoDir, WORKSPACE_DIRNAME);
}

export function workspaceProfilesDir(workspaceDir: string): string {
  return path.join(workspaceDir, WORKSPACE_PROFILES_DIRNAME);
}

export function workspaceProfileSessionsDir(workspaceDir: string): string {
  return path.join(workspaceDir, WORKSPACE_PROFILE_SESSIONS_DIRNAME);
}

export function resolveRepoDirForWorkspaceInit(opts?: { cwd?: string }): string {
  return path.resolve(opts?.cwd ?? providers().runtime.cwd());
}

export function resolveWorkspaceDir(opts?: { cwd?: string }): string | null {
  const fromEnv = providers().env.get("SURFWRIGHT_WORKSPACE_DIR");
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv.trim());
  }

  let current = path.resolve(opts?.cwd ?? providers().runtime.cwd());
  while (true) {
    const markerPath = workspaceMarkerPathForRepoDir(current);
    try {
      const raw = fs.readFileSync(markerPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<WorkspaceMarker>;
      if (parsed.version !== WORKSPACE_VERSION) {
        throw new CliError("E_WORKSPACE_INVALID", `Workspace marker version mismatch at ${markerPath}`);
      }
      return workspaceDirFromRepoDir(current);
    } catch (error) {
      if (error instanceof CliError) {
        throw error;
      }
      // ignore missing/invalid marker and continue walking up
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function requireWorkspaceDir(opts?: { cwd?: string }): string {
  const resolved = resolveWorkspaceDir(opts);
  if (!resolved) {
    throw new CliError(
      "E_WORKSPACE_NOT_FOUND",
      `No SurfWright workspace found. Run 'surfwright workspace init' in your project root (creates ./${WORKSPACE_DIRNAME}/).`,
    );
  }
  return resolved;
}

function readGitignore(repoDir: string): string | null {
  try {
    return fs.readFileSync(path.join(repoDir, ".gitignore"), "utf8");
  } catch {
    return null;
  }
}

function writeGitignore(repoDir: string, content: string): void {
  fs.writeFileSync(path.join(repoDir, ".gitignore"), content, { encoding: "utf8" });
}

function ensureGitignoreEntry(repoDir: string): { path: string; updated: boolean } {
  const gitignorePath = path.join(repoDir, ".gitignore");
  const existing = readGitignore(repoDir);
  const entry = `/${WORKSPACE_DIRNAME}/`;
  if (existing === null) {
    writeGitignore(repoDir, `${entry}\n`);
    return { path: gitignorePath, updated: true };
  }

  const lines = existing.split(/\r?\n/);
  if (lines.some((line) => line.trim() === entry || line.trim() === `${WORKSPACE_DIRNAME}/`)) {
    return { path: gitignorePath, updated: false };
  }

  const trimmed = existing.endsWith("\n") ? existing : `${existing}\n`;
  writeGitignore(repoDir, `${trimmed}${entry}\n`);
  return { path: gitignorePath, updated: true };
}

export function initWorkspaceInRepoDir(repoDir: string): {
  workspaceDir: string;
  markerPath: string;
  profilesDir: string;
  profileSessionsDir: string;
  gitignore: { path: string; updated: boolean };
} {
  const workspaceDir = workspaceDirFromRepoDir(repoDir);
  const markerPath = path.join(workspaceDir, WORKSPACE_MARKER_FILENAME);
  const profilesDir = workspaceProfilesDir(workspaceDir);
  const profileSessionsDir = workspaceProfileSessionsDir(workspaceDir);

  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(profilesDir, { recursive: true });
  fs.mkdirSync(profileSessionsDir, { recursive: true });

  const marker: WorkspaceMarker = {
    version: WORKSPACE_VERSION,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(markerPath, `${JSON.stringify(marker)}\n`, { encoding: "utf8" });

  const gitignore = ensureGitignoreEntry(repoDir);
  return {
    workspaceDir,
    markerPath,
    profilesDir,
    profileSessionsDir,
    gitignore,
  };
}
