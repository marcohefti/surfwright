import process from "node:process";
import { CDP_HEALTHCHECK_TIMEOUT_MS, isCdpEndpointAlive, killManagedBrowserProcessTree } from "../../browser.js";
import { hasSessionLeaseExpired, withSessionHeartbeat } from "../../session/index.js";
import { connectSessionBrowser } from "../../session/infra/runtime-access.js";
import type { SessionState } from "../../types.js";
import { mutateState } from "../repo/mutations.js";
import { nowIso, readState } from "./state-store.js";

const SESSION_PRUNE_REACHABILITY_TIMEOUT_CAP_MS = 1500;
const SESSION_CLEAR_SHUTDOWN_TIMEOUT_CAP_MS = 2000;
const SESSION_CLEAR_SIGTERM_GRACE_MS = 500;

function pidIsAlive(pid: number | null): boolean {
  if (!pid || !Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopManagedSessionProcess(session: SessionState): void {
  if (session.kind !== "managed") {
    return;
  }
  if (!pidIsAlive(session.browserPid ?? null)) {
    return;
  }
  killManagedBrowserProcessTree(session.browserPid ?? null, "SIGTERM");
}
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopManagedSessionProcessStrict(session: SessionState, timeoutMs: number): Promise<boolean> {
  const pid = session.browserPid ?? null;
  if (!pidIsAlive(pid)) {
    return true;
  }
  killManagedBrowserProcessTree(pid, "SIGTERM");

  const waitUntil = Date.now() + Math.max(100, Math.min(timeoutMs, SESSION_CLEAR_SIGTERM_GRACE_MS));
  while (Date.now() < waitUntil) {
    if (!pidIsAlive(pid)) {
      return true;
    }
    await delay(25);
  }

  if (!pidIsAlive(pid)) {
    return true;
  }

  killManagedBrowserProcessTree(pid, "SIGKILL");
  const killWaitUntil = Date.now() + 250;
  while (Date.now() < killWaitUntil) {
    if (!pidIsAlive(pid)) {
      return true;
    }
    await delay(25);
  }
  return !pidIsAlive(pid);
}


async function stopSessionViaCdp(session: SessionState, timeoutMs: number): Promise<boolean> {
  const cdpTimeoutMs = Math.max(CDP_HEALTHCHECK_TIMEOUT_MS, Math.min(timeoutMs, SESSION_CLEAR_SHUTDOWN_TIMEOUT_CAP_MS));
  const reachable = await isCdpEndpointAlive(session.cdpOrigin, cdpTimeoutMs);
  if (!reachable) {
    return false;
  }

  try {
    const browser = await connectSessionBrowser(session.cdpOrigin, {
      timeout: cdpTimeoutMs,
    });
    try {
      const cdp = await browser.newBrowserCDPSession();
      await cdp.send("Browser.close");
      return true;
    } finally {
      try {
        await browser.close();
      } catch {
        // Browser.close may sever CDP before Playwright disconnect completes.
      }
    }
  } catch {
    return false;
  }
}

export async function stopSessionProcess(session: SessionState, timeoutMs: number): Promise<boolean> {
  if (session.kind === "managed" && pidIsAlive(session.browserPid ?? null)) {
    return await stopManagedSessionProcessStrict(session, timeoutMs);
  }
  return await stopSessionViaCdp(session, timeoutMs);
}

export type SessionMaintenanceSummary = {
  activeSessionId: string | null;
  scanned: number;
  kept: number;
  removed: number;
  removedByLeaseExpired: number;
  removedAttachedUnreachable: number;
  removedManagedUnreachable: number;
  removedManagedByGrace: number;
  removedManagedByFlag: number;
  repairedManagedPid: number;
};

function sessionFingerprint(session: SessionState): string {
  return [
    session.kind,
    session.cdpOrigin,
    session.debugPort ?? "",
    session.userDataDir ?? "",
    session.browserPid ?? "",
    session.lastSeenAt,
  ].join("|");
}

export async function sessionPruneInternal(opts: {
  timeoutMs: number;
  dropManagedUnreachable: boolean;
  dropAttachedUnreachable: boolean;
}): Promise<SessionMaintenanceSummary> {
  const timeoutMs = Math.max(
    CDP_HEALTHCHECK_TIMEOUT_MS,
    Math.min(opts.timeoutMs, SESSION_PRUNE_REACHABILITY_TIMEOUT_CAP_MS),
  );
  const snapshot = readState();
  const snapshotSessions = Object.values(snapshot.sessions).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  const reachabilityBySessionId = new Map<
    string,
    {
      fingerprint: string;
      reachable: boolean;
    }
  >();
  for (const session of snapshotSessions) {
    if (hasSessionLeaseExpired(session)) {
      continue;
    }
    const reachable = await isCdpEndpointAlive(session.cdpOrigin, Math.max(CDP_HEALTHCHECK_TIMEOUT_MS, timeoutMs));
    reachabilityBySessionId.set(session.sessionId, {
      fingerprint: sessionFingerprint(session),
      reachable,
    });
  }

  const applied = await mutateState((state) => {
    const sessionIds = snapshotSessions.map((session) => session.sessionId);
    let removedByLeaseExpired = 0;
    let removedAttachedUnreachable = 0;
    let removedManagedUnreachable = 0;
    let removedManagedByGrace = 0;
    let removedManagedByFlag = 0;
    let repairedManagedPid = 0;
    const managedSessionsToStop: SessionState[] = [];

    for (const sessionId of sessionIds) {
      const session = state.sessions[sessionId];
      if (!session) {
        continue;
      }
      const probe = reachabilityBySessionId.get(sessionId);
      if (probe && probe.fingerprint !== sessionFingerprint(session)) {
        continue;
      }

      if (hasSessionLeaseExpired(session)) {
        if (session.kind === "managed") {
          managedSessionsToStop.push(session);
        }
        delete state.sessions[sessionId];
        removedByLeaseExpired += 1;
        continue;
      }

      const reachable = probe?.reachable;
      if (typeof reachable !== "boolean") {
        continue;
      }
      if (reachable) {
        state.sessions[sessionId] = withSessionHeartbeat(session);
        continue;
      }

      if (session.kind === "attached") {
        if (opts.dropAttachedUnreachable) {
          delete state.sessions[sessionId];
          removedAttachedUnreachable += 1;
        }
        continue;
      }

      const managedHasLivePid = pidIsAlive(session.browserPid ?? null);
      const nextUnreachableCount = Math.max(0, Math.floor(session.managedUnreachableCount ?? 0)) + 1;
      const managedUnreachableSince = session.managedUnreachableSince ?? nowIso();
      const shouldDropManaged = Boolean(opts.dropManagedUnreachable) || nextUnreachableCount >= 2;

      if (!managedHasLivePid && session.browserPid !== null) {
        state.sessions[sessionId] = {
          ...session,
          browserPid: null,
        };
        repairedManagedPid += 1;
      }
      if (shouldDropManaged) {
        managedSessionsToStop.push(session);
        delete state.sessions[sessionId];
        removedManagedUnreachable += 1;
        if (opts.dropManagedUnreachable) {
          removedManagedByFlag += 1;
        } else {
          removedManagedByGrace += 1;
        }
        continue;
      }

      state.sessions[sessionId] = {
        ...state.sessions[sessionId],
        managedUnreachableSince,
        managedUnreachableCount: nextUnreachableCount,
      };
    }

    if (state.activeSessionId && !state.sessions[state.activeSessionId]) {
      state.activeSessionId = null;
    }

    const kept = Object.keys(state.sessions).length;
    const scanned = sessionIds.length;
    const removed = removedByLeaseExpired + removedAttachedUnreachable + removedManagedUnreachable;

    return {
      summary: {
        activeSessionId: state.activeSessionId,
        scanned,
        kept,
        removed,
        removedByLeaseExpired,
        removedAttachedUnreachable,
        removedManagedUnreachable,
        removedManagedByGrace,
        removedManagedByFlag,
        repairedManagedPid,
      } satisfies SessionMaintenanceSummary,
      managedSessionsToStop,
    };
  });
  for (const session of applied.managedSessionsToStop) {
    stopManagedSessionProcess(session);
  }
  return applied.summary;
}
