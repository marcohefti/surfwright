import process from "node:process";
import { CDP_HEALTHCHECK_TIMEOUT_MS, isCdpEndpointAlive } from "./browser.js";
import { CliError } from "./errors.js";
import { nowIso, updateState } from "./state.js";
import type { SessionPruneReport, StateReconcileReport, TargetPruneReport } from "./types.js";

const DEFAULT_TARGET_MAX_AGE_HOURS = 168;
const DEFAULT_TARGET_MAX_PER_SESSION = 200;
const MAX_TARGET_MAX_AGE_HOURS = 8760;
const MAX_TARGET_MAX_PER_SESSION = 5000;

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
  removedAttachedUnreachable: number;
  removedManagedUnreachable: number;
  repairedManagedPid: number;
};

async function sessionPruneInternal(opts: {
  timeoutMs: number;
  dropManagedUnreachable: boolean;
  dropAttachedUnreachable: boolean;
}): Promise<SessionMaintenanceSummary> {
  const timeoutMs = opts.timeoutMs;
  return await updateState(async (state) => {
    const sessionIds = Object.keys(state.sessions).sort((a, b) => a.localeCompare(b));

    let removedAttachedUnreachable = 0;
    let removedManagedUnreachable = 0;
    let repairedManagedPid = 0;

    for (const sessionId of sessionIds) {
      const session = state.sessions[sessionId];
      if (!session) {
        continue;
      }

      const reachable = await isCdpEndpointAlive(session.cdpOrigin, Math.max(CDP_HEALTHCHECK_TIMEOUT_MS, timeoutMs));
      if (reachable) {
        state.sessions[sessionId] = {
          ...session,
          lastSeenAt: nowIso(),
        };
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
      if (!managedHasLivePid && session.browserPid !== null) {
        state.sessions[sessionId] = {
          ...session,
          browserPid: null,
        };
        repairedManagedPid += 1;
      }

      if (opts.dropManagedUnreachable) {
        delete state.sessions[sessionId];
        removedManagedUnreachable += 1;
      }
    }

    if (state.activeSessionId && !state.sessions[state.activeSessionId]) {
      state.activeSessionId = null;
    }

    const kept = Object.keys(state.sessions).length;
    const scanned = sessionIds.length;
    const removed = removedAttachedUnreachable + removedManagedUnreachable;

    return {
      activeSessionId: state.activeSessionId,
      scanned,
      kept,
      removed,
      removedAttachedUnreachable,
      removedManagedUnreachable,
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

  return await updateState(async (state) => {
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
      removedAttachedUnreachable: sessionSummary.removedAttachedUnreachable,
      removedManagedUnreachable: sessionSummary.removedManagedUnreachable,
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
