import process from "node:process";
import { killManagedBrowserProcessTree } from "../../browser.js";
import { CliError } from "../../errors.js";
import { readState } from "./state-store.js";
import { mutateState } from "../repo/mutations.js";
import type { SessionState } from "../../types.js";

const DEFAULT_IDLE_MANAGED_PROCESS_TTL_MS = 30 * 60 * 1000;
const MIN_IDLE_MANAGED_PROCESS_TTL_MS = 60 * 1000;
const MAX_IDLE_MANAGED_PROCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_IDLE_MANAGED_PROCESS_SWEEP_CAP = 6;
const MAX_IDLE_MANAGED_PROCESS_SWEEP_CAP = 200;
const IDLE_MANAGED_PROCESS_SHUTDOWN_TIMEOUT_MS = 500;
const IDLE_MANAGED_PROCESS_SIGTERM_GRACE_MS = 300;

export type SessionParkIdleManagedProcessesReport = {
  ok: true;
  scannedManaged: number;
  idleEligible: number;
  shutdownRequested: number;
  shutdownSucceeded: number;
  shutdownFailed: number;
  parked: number;
  idleTtlMs: number;
  sweepCap: number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function stopManagedSessionProcessStrict(session: SessionState, timeoutMs: number): Promise<boolean> {
  const pid = session.browserPid ?? null;
  if (!pidIsAlive(pid)) {
    return true;
  }
  killManagedBrowserProcessTree(pid, "SIGTERM");

  const waitUntil = Date.now() + Math.max(100, Math.min(timeoutMs, IDLE_MANAGED_PROCESS_SIGTERM_GRACE_MS));
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

function parseIdleManagedProcessConfig(opts: {
  idleTtlMs?: number;
  sweepCap?: number;
}): {
  idleTtlMs: number;
  sweepCap: number;
} {
  const idleTtlMs = parseOptionalPositiveIntInRange({
    value: opts.idleTtlMs,
    name: "idle-ttl-ms",
    min: MIN_IDLE_MANAGED_PROCESS_TTL_MS,
    max: MAX_IDLE_MANAGED_PROCESS_TTL_MS,
    fallback: DEFAULT_IDLE_MANAGED_PROCESS_TTL_MS,
  });

  const sweepCap = parseOptionalPositiveIntInRange({
    value: opts.sweepCap,
    name: "sweep-cap",
    min: 1,
    max: MAX_IDLE_MANAGED_PROCESS_SWEEP_CAP,
    fallback: DEFAULT_IDLE_MANAGED_PROCESS_SWEEP_CAP,
  });

  return {
    idleTtlMs,
    sweepCap,
  };
}

export async function sessionParkIdleManagedProcesses(opts: {
  idleTtlMs?: number;
  sweepCap?: number;
}): Promise<SessionParkIdleManagedProcessesReport> {
  const parsed = parseIdleManagedProcessConfig({
    idleTtlMs: opts.idleTtlMs,
    sweepCap: opts.sweepCap,
  });
  const idleCutoffMs = Date.now() - parsed.idleTtlMs;
  const snapshot = readState();

  let scannedManaged = 0;
  let idleEligible = 0;
  const candidates: SessionState[] = [];
  const sessions = Object.values(snapshot.sessions).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  for (const session of sessions) {
    if (session.kind !== "managed") {
      continue;
    }
    scannedManaged += 1;
    const lastSeenMs = Date.parse(session.lastSeenAt);
    if (!Number.isFinite(lastSeenMs)) {
      continue;
    }
    if (lastSeenMs > idleCutoffMs) {
      continue;
    }
    const pid = session.browserPid ?? null;
    if (!pidIsAlive(pid)) {
      continue;
    }
    idleEligible += 1;
    if (candidates.length < parsed.sweepCap) {
      candidates.push(session);
    }
  }

  let shutdownRequested = 0;
  let shutdownSucceeded = 0;
  let shutdownFailed = 0;
  const candidateIds = new Set(candidates.map((session) => session.sessionId));
  for (const session of candidates) {
    shutdownRequested += 1;
    const stopped = await stopManagedSessionProcessStrict(session, IDLE_MANAGED_PROCESS_SHUTDOWN_TIMEOUT_MS);
    if (stopped) {
      shutdownSucceeded += 1;
    } else {
      shutdownFailed += 1;
    }
  }

  const parked = await mutateState((state) => {
    let parkedCount = 0;
    for (const sessionId of candidateIds) {
      const existing = state.sessions[sessionId];
      if (!existing || existing.kind !== "managed") {
        continue;
      }
      const pid = existing.browserPid ?? null;
      if (pidIsAlive(pid) || existing.browserPid === null) {
        continue;
      }
      state.sessions[sessionId] = {
        ...existing,
        browserPid: null,
      };
      parkedCount += 1;
    }
    return parkedCount;
  });

  return {
    ok: true,
    scannedManaged,
    idleEligible,
    shutdownRequested,
    shutdownSucceeded,
    shutdownFailed,
    parked,
    idleTtlMs: parsed.idleTtlMs,
    sweepCap: parsed.sweepCap,
  };
}
