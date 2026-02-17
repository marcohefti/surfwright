import fs from "node:fs";
import path from "node:path";

import { allocateFreePort, isCdpEndpointReachable, killManagedBrowserProcessTree, startManagedSession } from "../../browser.js";
import { CliError } from "../../errors.js";
import { nowIso, readState } from "../../state/index.js";
import type { ManagedBrowserMode, SessionState } from "../../types.js";
import { currentAgentId, withSessionHeartbeat } from "../../session/index.js";
import { requireWorkspaceDir, workspaceProfilesDir, workspaceProfileSessionsDir } from "../../workspace/index.js";

const PROFILE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const PROFILE_SESSION_META_VERSION = 1;

const PROFILE_LOCK_RETRY_MS = 40;
const PROFILE_LOCK_TIMEOUT_MS = 2500;
const PROFILE_LOCK_STALE_MS = 20000;

type ProfileSessionMeta = {
  version: number;
  profile: string;
  sessionId: string;
  cdpOrigin: string;
  debugPort: number;
  browserPid: number;
  browserMode: "headless" | "headed";
  startedAt: string;
  ownerId: string | null;
};

function profileSessionId(profile: string): string {
  return `p.${profile}`;
}

export function sanitizeProfileName(input: string): string {
  const value = input.trim();
  if (!PROFILE_NAME_PATTERN.test(value)) {
    throw new CliError(
      "E_PROFILE_INVALID",
      "profile may only contain letters, numbers, dot, underscore, and dash",
    );
  }
  return value;
}

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

function metaPath(workspaceDir: string, profile: string): string {
  return path.join(workspaceProfileSessionsDir(workspaceDir), `${profile}.json`);
}

function lockPath(workspaceDir: string, profile: string): string {
  return path.join(workspaceProfileSessionsDir(workspaceDir), `${profile}.lock`);
}

function readMeta(workspaceDir: string, profile: string): ProfileSessionMeta | null {
  try {
    const raw = fs.readFileSync(metaPath(workspaceDir, profile), "utf8");
    const parsed = JSON.parse(raw) as Partial<ProfileSessionMeta>;
    if (
      parsed.version !== PROFILE_SESSION_META_VERSION ||
      parsed.profile !== profile ||
      typeof parsed.sessionId !== "string" ||
      parsed.sessionId !== profileSessionId(profile) ||
      typeof parsed.cdpOrigin !== "string" ||
      typeof parsed.debugPort !== "number" ||
      typeof parsed.browserPid !== "number" ||
      (parsed.browserMode !== "headless" && parsed.browserMode !== "headed") ||
      typeof parsed.startedAt !== "string"
    ) {
      return null;
    }
    return {
      version: PROFILE_SESSION_META_VERSION,
      profile,
      sessionId: parsed.sessionId,
      cdpOrigin: parsed.cdpOrigin,
      debugPort: parsed.debugPort,
      browserPid: parsed.browserPid,
      browserMode: parsed.browserMode,
      startedAt: parsed.startedAt,
      ownerId: typeof parsed.ownerId === "string" && parsed.ownerId.length > 0 ? parsed.ownerId : null,
    };
  } catch {
    return null;
  }
}

function writeMeta(workspaceDir: string, profile: string, meta: ProfileSessionMeta): void {
  const dir = workspaceProfileSessionsDir(workspaceDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(metaPath(workspaceDir, profile), `${JSON.stringify(meta)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function removeMeta(workspaceDir: string, profile: string): void {
  try {
    fs.unlinkSync(metaPath(workspaceDir, profile));
  } catch {
    // ignore
  }
}

function removeLock(workspaceDir: string, profile: string): void {
  try {
    fs.unlinkSync(lockPath(workspaceDir, profile));
  } catch {
    // ignore
  }
}

function tryAcquireLock(workspaceDir: string, profile: string): boolean {
  try {
    fs.writeFileSync(lockPath(workspaceDir, profile), `${process.pid} ${Date.now()}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function readLock(workspaceDir: string, profile: string): { pid: number | null; ts: number | null } {
  try {
    const raw = fs.readFileSync(lockPath(workspaceDir, profile), "utf8").trim();
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

async function acquireLockOrThrow(workspaceDir: string, profile: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + Math.min(timeoutMs, PROFILE_LOCK_TIMEOUT_MS);
  while (Date.now() < deadline) {
    if (tryAcquireLock(workspaceDir, profile)) {
      return;
    }
    const existing = readLock(workspaceDir, profile);
    const ageMs = existing.ts ? Date.now() - existing.ts : null;
    if (ageMs !== null && ageMs > PROFILE_LOCK_STALE_MS && (existing.pid === null || !isProcessAlive(existing.pid))) {
      removeLock(workspaceDir, profile);
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, PROFILE_LOCK_RETRY_MS));
  }
  throw new CliError("E_PROFILE_LOCKED", `profile ${profile} is currently in use by another process`);
}

function ensureStateAcceptsProfileSession(session: SessionState, profile: string): void {
  const snapshot = readState();
  const existing = snapshot.sessions[session.sessionId];
  if (!existing) {
    return;
  }
  if (existing.kind !== "managed") {
    throw new CliError("E_SESSION_CONFLICT", `Reserved profile session ${session.sessionId} conflicts with existing kind`);
  }
  if ((existing.profile ?? null) !== profile) {
    throw new CliError("E_SESSION_CONFLICT", `Reserved profile session ${session.sessionId} conflicts with existing profile`);
  }
}

export async function ensureProfileManagedSession(opts: {
  profileInput: string;
  timeoutMs: number;
  browserMode?: ManagedBrowserMode;
}): Promise<{ session: SessionState; created: boolean; restarted: boolean }> {
  const profile = sanitizeProfileName(opts.profileInput);
  const workspaceDir = requireWorkspaceDir();
  fs.mkdirSync(workspaceProfilesDir(workspaceDir), { recursive: true });
  fs.mkdirSync(workspaceProfileSessionsDir(workspaceDir), { recursive: true });
  const sessionId = profileSessionId(profile);
  const desiredMode: ManagedBrowserMode = opts.browserMode ?? "headless";

  await acquireLockOrThrow(workspaceDir, profile, opts.timeoutMs);
  try {
    const existing = readMeta(workspaceDir, profile);
    if (existing && isProcessAlive(existing.browserPid) && (await isCdpEndpointReachable(existing.cdpOrigin, opts.timeoutMs))) {
      if (existing.browserMode !== desiredMode) {
        killManagedBrowserProcessTree(existing.browserPid, "SIGTERM");
        removeMeta(workspaceDir, profile);
      } else {
        const sessionRaw: SessionState = {
          sessionId,
          kind: "managed",
          policy: "persistent",
          browserMode: existing.browserMode,
          cdpOrigin: existing.cdpOrigin,
          debugPort: existing.debugPort,
          userDataDir: path.join(workspaceProfilesDir(workspaceDir), profile),
          profile,
          browserPid: existing.browserPid,
          ownerId: existing.ownerId,
          leaseExpiresAt: null,
          leaseTtlMs: null,
          managedUnreachableSince: null,
          managedUnreachableCount: 0,
          createdAt: existing.startedAt,
          lastSeenAt: nowIso(),
        };
        const session = withSessionHeartbeat(sessionRaw, nowIso());
        ensureStateAcceptsProfileSession(session, profile);
        return { session, created: false, restarted: false };
      }
    }
    if (existing) {
      removeMeta(workspaceDir, profile);
    }

    const debugPort = await allocateFreePort();
    const created = await startManagedSession(
      {
        sessionId,
        debugPort,
        userDataDir: path.join(workspaceProfilesDir(workspaceDir), profile),
        browserMode: desiredMode,
        policy: "persistent",
        profile,
        createdAt: nowIso(),
      },
      opts.timeoutMs,
    );
    ensureStateAcceptsProfileSession(created, profile);
    writeMeta(workspaceDir, profile, {
      version: PROFILE_SESSION_META_VERSION,
      profile,
      sessionId: created.sessionId,
      cdpOrigin: created.cdpOrigin,
      debugPort: created.debugPort ?? debugPort,
      browserPid: created.browserPid ?? 0,
      browserMode: created.browserMode === "headed" ? "headed" : "headless",
      startedAt: created.createdAt,
      ownerId: currentAgentId(),
    });
    return { session: created, created: true, restarted: false };
  } finally {
    removeLock(workspaceDir, profile);
  }
}
