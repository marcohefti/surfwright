import process from "node:process";
import { chromium } from "playwright-core";
import { CDP_HEALTHCHECK_TIMEOUT_MS, isCdpEndpointAlive, killManagedBrowserProcessTree } from "../../browser.js";
import { CliError } from "../../errors.js";
import { hasSessionLeaseExpired, withSessionHeartbeat } from "../../session/index.js";
import { nowIso, readState, sanitizeSessionId } from "./state-store.js";
import { mutateState } from "../repo/mutations.js";
import type { SessionPruneReport, SessionState, StateReconcileReport, TargetPruneReport } from "../../types.js";

const DEFAULT_TARGET_MAX_AGE_HOURS = 168;
const DEFAULT_TARGET_MAX_PER_SESSION = 200;
const MAX_TARGET_MAX_AGE_HOURS = 8760;
const MAX_TARGET_MAX_PER_SESSION = 5000;
const SESSION_PRUNE_REACHABILITY_TIMEOUT_CAP_MS = 1500;
const SESSION_CLEAR_SHUTDOWN_TIMEOUT_CAP_MS = 2000;
const SESSION_CLEAR_SIGTERM_GRACE_MS = 500;

export type SessionClearReport = {
  ok: true;
  activeSessionId: string | null;
  scope: "all" | "session";
  requestedSessionId: string | null;
  scanned: number;
  cleared: number;
  clearedSessionIds: string[];
  clearedManaged: number;
  clearedAttached: number;
  keepProcesses: boolean;
  processShutdown: {
    requested: number;
    succeeded: number;
    failed: number;
  };
  targetsRemoved: number;
  networkCapturesRemoved: number;
  networkArtifactsRemoved: number;
  warnings: string[];
};

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
    const browser = await chromium.connectOverCDP(session.cdpOrigin, {
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

async function stopSessionProcess(session: SessionState, timeoutMs: number): Promise<boolean> {
  if (session.kind === "managed" && pidIsAlive(session.browserPid ?? null)) {
    return await stopManagedSessionProcessStrict(session, timeoutMs);
  }
  return await stopSessionViaCdp(session, timeoutMs);
}

function parseOptionalPositiveIntInRange(opts: {
  value: number | undefined;
  name: string;
  min: number;
  max: number;
  fallback: number;
}): number {
  if (typeof opts.value === "undefined") {
    return opts.fallback;
  }

  if (!Number.isFinite(opts.value) || !Number.isInteger(opts.value) || opts.value < opts.min || opts.value > opts.max) {
    throw new CliError("E_QUERY_INVALID", `${opts.name} must be an integer between ${opts.min} and ${opts.max}`);
  }

  return opts.value;
}

type SessionMaintenanceSummary = {
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

async function sessionPruneInternal(opts: {
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

function parseTargetPruneConfig(opts: {
  maxAgeHours?: number;
  maxPerSession?: number;
}): {
  maxAgeHours: number;
  maxPerSession: number;
} {
  const maxAgeHours = parseOptionalPositiveIntInRange({
    value: opts.maxAgeHours,
    name: "max-age-hours",
    min: 1,
    max: MAX_TARGET_MAX_AGE_HOURS,
    fallback: DEFAULT_TARGET_MAX_AGE_HOURS,
  });

  const maxPerSession = parseOptionalPositiveIntInRange({
    value: opts.maxPerSession,
    name: "max-per-session",
    min: 1,
    max: MAX_TARGET_MAX_PER_SESSION,
    fallback: DEFAULT_TARGET_MAX_PER_SESSION,
  });

  return {
    maxAgeHours,
    maxPerSession,
  };
}

async function targetPruneInternal(opts: { maxAgeHours: number; maxPerSession: number }): Promise<TargetPruneReport> {
  const cutoffMs = Date.now() - opts.maxAgeHours * 60 * 60 * 1000;

  return await mutateState((state) => {
    const entries = Object.entries(state.targets);
    const scanned = entries.length;

    let removedOrphaned = 0;
    let removedByAge = 0;
    let removedByCap = 0;

    const keptBySession = new Map<
      string,
      Array<{
        targetId: string;
        updatedAtMs: number;
      }>
    >();

    for (const [targetId, target] of entries) {
      const hasSession = Boolean(state.sessions[target.sessionId]);
      if (!hasSession) {
        delete state.targets[targetId];
        removedOrphaned += 1;
        continue;
      }

      const updatedAtMs = Date.parse(target.updatedAt);
      const normalizedUpdatedAtMs = Number.isFinite(updatedAtMs) ? updatedAtMs : 0;
      if (normalizedUpdatedAtMs < cutoffMs) {
        delete state.targets[targetId];
        removedByAge += 1;
        continue;
      }

      const list = keptBySession.get(target.sessionId) ?? [];
      list.push({
        targetId,
        updatedAtMs: normalizedUpdatedAtMs,
      });
      keptBySession.set(target.sessionId, list);
    }

    for (const [, targets] of keptBySession) {
      targets.sort((a, b) => {
        if (b.updatedAtMs !== a.updatedAtMs) {
          return b.updatedAtMs - a.updatedAtMs;
        }
        return a.targetId.localeCompare(b.targetId);
      });
      const overflow = targets.slice(opts.maxPerSession);
      for (const target of overflow) {
        delete state.targets[target.targetId];
        removedByCap += 1;
      }
    }

    const remaining = Object.keys(state.targets).length;
    const removed = removedOrphaned + removedByAge + removedByCap;

    return {
      ok: true,
      activeSessionId: state.activeSessionId,
      scanned,
      remaining,
      removed,
      removedOrphaned,
      removedByAge,
      removedByCap,
      maxAgeHours: opts.maxAgeHours,
      maxPerSession: opts.maxPerSession,
    };
  });
}

export async function sessionPrune(opts: {
  timeoutMs: number;
  dropManagedUnreachable?: boolean;
}): Promise<SessionPruneReport> {
  const summary = await sessionPruneInternal({
    timeoutMs: opts.timeoutMs,
    dropManagedUnreachable: Boolean(opts.dropManagedUnreachable),
    dropAttachedUnreachable: true,
  });

  return {
    ok: true,
    ...summary,
  };
}

export async function sessionClear(opts: {
  timeoutMs: number;
  keepProcesses?: boolean;
  sessionId?: string;
}): Promise<SessionClearReport> {
  const timeoutMs = Math.max(
    CDP_HEALTHCHECK_TIMEOUT_MS,
    Math.min(opts.timeoutMs, SESSION_CLEAR_SHUTDOWN_TIMEOUT_CAP_MS),
  );
  const keepProcesses = Boolean(opts.keepProcesses);
  const requestedSessionId =
    typeof opts.sessionId === "string" && opts.sessionId.trim().length > 0 ? sanitizeSessionId(opts.sessionId) : null;
  const scope: SessionClearReport["scope"] = requestedSessionId ? "session" : "all";
  const snapshot = readState();
  const allSnapshotSessions = Object.values(snapshot.sessions).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  const selectedSnapshotSessions =
    requestedSessionId === null
      ? allSnapshotSessions
      : (() => {
          const found = snapshot.sessions[requestedSessionId];
          if (!found) {
            throw new CliError("E_SESSION_NOT_FOUND", `Session ${requestedSessionId} not found`, {
              hints: [
                "Run `surfwright session list` to inspect known sessions",
                "Use `surfwright session clear` without --session to clear all sessions",
              ],
              hintContext: {
                requestedSessionId,
                activeSessionId: snapshot.activeSessionId ?? null,
                knownSessionCount: allSnapshotSessions.length,
              },
            });
          }
          return [found];
        })();

  let shutdownRequested = 0;
  let shutdownSucceeded = 0;
  let shutdownFailed = 0;
  const preShutdownAttemptedSessionIds = new Set<string>();
  if (!keepProcesses) {
    for (const session of selectedSnapshotSessions) {
      shutdownRequested += 1;
      preShutdownAttemptedSessionIds.add(session.sessionId);
      const stopped = await stopSessionProcess(session, timeoutMs);
      if (stopped) {
        shutdownSucceeded += 1;
      } else {
        shutdownFailed += 1;
      }
    }
  }

  const applied = await mutateState((state) => {
    const allCurrentSessions = Object.values(state.sessions).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    const sessionsToClear =
      requestedSessionId === null
        ? allCurrentSessions
        : (() => {
            const found = state.sessions[requestedSessionId];
            return found ? [found] : [];
          })();
    const scanned = sessionsToClear.length;
    const clearedSessionIds = sessionsToClear.map((session) => session.sessionId);
    const clearedSessionIdSet = new Set(clearedSessionIds);
    let clearedManaged = 0;
    let clearedAttached = 0;
    const postShutdownSessions: SessionState[] = [];
    for (const session of sessionsToClear) {
      if (session.kind === "managed") {
        clearedManaged += 1;
      } else {
        clearedAttached += 1;
      }
      if (!keepProcesses && !preShutdownAttemptedSessionIds.has(session.sessionId)) {
        postShutdownSessions.push(session);
      }
    }

    let targetsRemoved = 0;
    let networkCapturesRemoved = 0;
    let networkArtifactsRemoved = 0;

    if (scope === "all") {
      targetsRemoved = Object.keys(state.targets).length;
      networkCapturesRemoved = Object.keys(state.networkCaptures).length;
      networkArtifactsRemoved = Object.keys(state.networkArtifacts).length;
      state.sessions = {};
      state.targets = {};
      state.networkCaptures = {};
      state.networkArtifacts = {};
    } else {
      for (const sessionId of clearedSessionIds) {
        delete state.sessions[sessionId];
      }
      for (const [targetId, target] of Object.entries(state.targets)) {
        if (!clearedSessionIdSet.has(target.sessionId)) {
          continue;
        }
        delete state.targets[targetId];
        targetsRemoved += 1;
      }
      for (const [captureId, capture] of Object.entries(state.networkCaptures)) {
        if (!clearedSessionIdSet.has(capture.sessionId)) {
          continue;
        }
        delete state.networkCaptures[captureId];
        networkCapturesRemoved += 1;
      }
      for (const [artifactId, artifact] of Object.entries(state.networkArtifacts)) {
        if (!clearedSessionIdSet.has(artifact.sessionId)) {
          continue;
        }
        delete state.networkArtifacts[artifactId];
        networkArtifactsRemoved += 1;
      }
    }

    if (state.activeSessionId && clearedSessionIdSet.has(state.activeSessionId)) {
      state.activeSessionId = null;
    }

    return {
      activeSessionId: state.activeSessionId,
      scanned,
      cleared: scanned,
      clearedSessionIds,
      clearedManaged,
      clearedAttached,
      targetsRemoved,
      networkCapturesRemoved,
      networkArtifactsRemoved,
      postShutdownSessions,
    };
  });

  if (!keepProcesses) {
    for (const session of applied.postShutdownSessions) {
      shutdownRequested += 1;
      const stopped = await stopSessionProcess(session, timeoutMs);
      if (stopped) {
        shutdownSucceeded += 1;
      } else {
        shutdownFailed += 1;
      }
    }
  }

  const warnings: string[] = [];
  if (scope === "all" && applied.scanned >= 20) {
    warnings.push(
      `Cleared ${applied.scanned} sessions in one pass; prefer --session <id> for scoped cleanup during active campaigns`,
    );
  }
  if (!keepProcesses && shutdownFailed > 0) {
    warnings.push(
      `${shutdownFailed} session process shutdowns failed; run session prune/state reconcile to repair stale session mappings`,
    );
  }

  return {
    ok: true,
    activeSessionId: applied.activeSessionId,
    scope,
    requestedSessionId,
    scanned: applied.scanned,
    cleared: applied.cleared,
    clearedSessionIds: applied.clearedSessionIds,
    clearedManaged: applied.clearedManaged,
    clearedAttached: applied.clearedAttached,
    keepProcesses,
    processShutdown: {
      requested: shutdownRequested,
      succeeded: shutdownSucceeded,
      failed: shutdownFailed,
    },
    targetsRemoved: applied.targetsRemoved,
    networkCapturesRemoved: applied.networkCapturesRemoved,
    networkArtifactsRemoved: applied.networkArtifactsRemoved,
    warnings,
  };
}

export async function targetPrune(opts: { maxAgeHours?: number; maxPerSession?: number }): Promise<TargetPruneReport> {
  const parsed = parseTargetPruneConfig({
    maxAgeHours: opts.maxAgeHours,
    maxPerSession: opts.maxPerSession,
  });

  return await targetPruneInternal(parsed);
}


export async function stateReconcile(opts: {
  timeoutMs: number;
  maxAgeHours?: number;
  maxPerSession?: number;
  dropManagedUnreachable?: boolean;
}): Promise<StateReconcileReport> {
  const parsedPrune = parseTargetPruneConfig({
    maxAgeHours: opts.maxAgeHours,
    maxPerSession: opts.maxPerSession,
  });

  const sessionSummary = await sessionPruneInternal({
    timeoutMs: opts.timeoutMs,
    dropManagedUnreachable: Boolean(opts.dropManagedUnreachable),
    dropAttachedUnreachable: true,
  });

  const targetSummary = await targetPruneInternal(parsedPrune);

  return {
    ok: true,
    activeSessionId: targetSummary.activeSessionId,
    sessions: {
      scanned: sessionSummary.scanned,
      kept: sessionSummary.kept,
      removed: sessionSummary.removed,
      removedByLeaseExpired: sessionSummary.removedByLeaseExpired,
      removedAttachedUnreachable: sessionSummary.removedAttachedUnreachable,
      removedManagedUnreachable: sessionSummary.removedManagedUnreachable,
      removedManagedByGrace: sessionSummary.removedManagedByGrace,
      removedManagedByFlag: sessionSummary.removedManagedByFlag,
      repairedManagedPid: sessionSummary.repairedManagedPid,
    },
    targets: {
      scanned: targetSummary.scanned,
      remaining: targetSummary.remaining,
      removed: targetSummary.removed,
      removedOrphaned: targetSummary.removedOrphaned,
      removedByAge: targetSummary.removedByAge,
      removedByCap: targetSummary.removedByCap,
      maxAgeHours: targetSummary.maxAgeHours,
      maxPerSession: targetSummary.maxPerSession,
    },
  };
}
