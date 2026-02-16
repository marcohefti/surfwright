import process from "node:process";
import { chromium } from "playwright-core";
import { CDP_HEALTHCHECK_TIMEOUT_MS, isCdpEndpointAlive } from "../../browser.js";
import { CliError } from "../../errors.js";
import { hasSessionLeaseExpired, withSessionHeartbeat } from "../../session/index.js";
import { nowIso } from "../../state.js";
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
  activeSessionId: null;
  scanned: number;
  cleared: number;
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
  try {
    process.kill(session.browserPid ?? 0, "SIGTERM");
  } catch {
    // best-effort termination for stale managed sessions
  }
}
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopManagedSessionProcessStrict(session: SessionState, timeoutMs: number): Promise<boolean> {
  const pid = session.browserPid ?? null;
  if (!pidIsAlive(pid)) {
    return true;
  }
  try {
    process.kill(pid ?? 0, "SIGTERM");
  } catch {
    return false;
  }

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

  try {
    process.kill(pid ?? 0, "SIGKILL");
  } catch {
    return false;
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

async function sessionPruneInternal(opts: {
  timeoutMs: number;
  dropManagedUnreachable: boolean;
  dropAttachedUnreachable: boolean;
}): Promise<SessionMaintenanceSummary> {
  const timeoutMs = Math.max(
    CDP_HEALTHCHECK_TIMEOUT_MS,
    Math.min(opts.timeoutMs, SESSION_PRUNE_REACHABILITY_TIMEOUT_CAP_MS),
  );
  return await mutateState(async (state) => {
    const sessionIds = Object.keys(state.sessions).sort((a, b) => a.localeCompare(b));

    let removedByLeaseExpired = 0;
    let removedAttachedUnreachable = 0;
    let removedManagedUnreachable = 0;
    let removedManagedByGrace = 0;
    let removedManagedByFlag = 0;
    let repairedManagedPid = 0;

    for (const sessionId of sessionIds) {
      const session = state.sessions[sessionId];
      if (!session) {
        continue;
      }

      if (hasSessionLeaseExpired(session)) {
        stopManagedSessionProcess(session);
        delete state.sessions[sessionId];
        removedByLeaseExpired += 1;
        continue;
      }

      const reachable = await isCdpEndpointAlive(session.cdpOrigin, Math.max(CDP_HEALTHCHECK_TIMEOUT_MS, timeoutMs));
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
        stopManagedSessionProcess(session);
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
    };
  });
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

  return await mutateState(async (state) => {
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
}): Promise<SessionClearReport> {
  const timeoutMs = Math.max(
    CDP_HEALTHCHECK_TIMEOUT_MS,
    Math.min(opts.timeoutMs, SESSION_CLEAR_SHUTDOWN_TIMEOUT_CAP_MS),
  );
  const keepProcesses = Boolean(opts.keepProcesses);

  return await mutateState(async (state) => {
    const sessions = Object.values(state.sessions).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    const scanned = sessions.length;
    let clearedManaged = 0;
    let clearedAttached = 0;
    let shutdownRequested = 0;
    let shutdownSucceeded = 0;
    let shutdownFailed = 0;

    for (const session of sessions) {
      if (session.kind === "managed") {
        clearedManaged += 1;
      } else {
        clearedAttached += 1;
      }
      if (keepProcesses) {
        continue;
      }
      shutdownRequested += 1;
      const stopped = await stopSessionProcess(session, timeoutMs);
      if (stopped) {
        shutdownSucceeded += 1;
      } else {
        shutdownFailed += 1;
      }
    }

    const targetsRemoved = Object.keys(state.targets).length;
    const networkCapturesRemoved = Object.keys(state.networkCaptures).length;
    const networkArtifactsRemoved = Object.keys(state.networkArtifacts).length;

    state.activeSessionId = null;
    state.sessions = {};
    state.targets = {};
    state.networkCaptures = {};
    state.networkArtifacts = {};

    return {
      ok: true,
      activeSessionId: null,
      scanned,
      cleared: scanned,
      clearedManaged,
      clearedAttached,
      keepProcesses,
      processShutdown: {
        requested: shutdownRequested,
        succeeded: shutdownSucceeded,
        failed: shutdownFailed,
      },
      targetsRemoved,
      networkCapturesRemoved,
      networkArtifactsRemoved,
    };
  });
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
