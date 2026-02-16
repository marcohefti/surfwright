import {
  allocateFreePort,
  ensureDefaultManagedSession,
  ensureSessionReachable,
  isCdpEndpointReachable,
  normalizeCdpOrigin,
  startManagedSession,
} from "../browser.js";
import { CliError } from "../errors.js";
import {
  assertSessionDoesNotExist,
  allocateSessionIdForState,
  defaultSessionUserDataDir,
  inferDebugPortFromCdpOrigin,
  listSessionsSnapshot,
  mutateState,
  nowIso,
  readState,
  sanitizeSessionId,
  sessionClear,
  sessionPrune,
} from "../state/index.js";
import {
  defaultSessionPolicyForKind,
  normalizeSessionLeaseTtlMs,
  normalizeSessionPolicy,
  withSessionHeartbeat,
} from "./app/hygiene.js";
import { buildSessionReport } from "../session-report.js";
import type { DoctorReport, OpenReport, SessionListReport, SessionReport, SessionState } from "../types.js";
import { parseManagedBrowserMode } from "./app/browser-mode.js";
import { openUrl as openUrlInternal } from "./infra/open.js";
import { getDoctorReport as getDoctorReportInternal } from "./infra/doctor.js";

export function getDoctorReport(): DoctorReport {
  return getDoctorReportInternal();
}

export async function openUrl(opts: {
  inputUrl: string;
  timeoutMs: number;
  sessionId?: string;
  reuseUrl?: boolean;
  isolation?: string;
  browserModeInput?: string;
}): Promise<OpenReport> {
  return await openUrlInternal({
    ...opts,
    ensureSharedSession: async ({ timeoutMs }) =>
      await sessionEnsure({
        timeoutMs,
        browserModeInput: opts.browserModeInput,
      }),
  });
}

export async function sessionEnsure(opts: { timeoutMs: number; browserModeInput?: string }): Promise<SessionReport> {
  const desiredBrowserMode = parseManagedBrowserMode(opts.browserModeInput);
  await sessionPrune({
    timeoutMs: opts.timeoutMs,
    dropManagedUnreachable: false,
  });

  const snapshot = readState();
  if (snapshot.activeSessionId && snapshot.sessions[snapshot.activeSessionId]) {
    const activeId = snapshot.activeSessionId;
    const activeSession = snapshot.sessions[activeId];
    try {
      const ensured = await ensureSessionReachable(
        activeSession,
        opts.timeoutMs,
        desiredBrowserMode ? { browserMode: desiredBrowserMode } : undefined,
      );
      return await mutateState(async (state) => {
        const current = state.sessions[activeId];
        if (!current) {
          throw new CliError("E_SESSION_NOT_FOUND", `Session ${activeId} not found`);
        }
        state.sessions[activeId] = ensured.session;
        state.activeSessionId = activeId;
        return buildSessionReport(ensured.session, {
          active: true,
          created: false,
          restarted: ensured.restarted,
        });
      });
    } catch (error) {
      if (!(error instanceof CliError) || error.code !== "E_SESSION_UNREACHABLE" || activeSession.kind !== "attached") {
        throw error;
      }
      // Guardrail: never auto-attach to unknown running browsers. If an attached session is dead,
      // fallback to a managed default session instead of probing/attaching elsewhere.
    }
  }

  return await mutateState(async (state) => {
    const ensuredDefault = await ensureDefaultManagedSession(
      state,
      opts.timeoutMs,
      desiredBrowserMode ? { browserMode: desiredBrowserMode } : undefined,
    );
    state.activeSessionId = ensuredDefault.session.sessionId;
    return buildSessionReport(ensuredDefault.session, {
      active: true,
      created: ensuredDefault.created,
      restarted: ensuredDefault.restarted,
    });
  });
}

export async function sessionNew(opts: {
  timeoutMs: number;
  requestedSessionId?: string;
  policyInput?: string;
  leaseTtlMs?: number;
  browserModeInput?: string;
}): Promise<SessionReport> {
  const policy = typeof opts.policyInput === "string" ? normalizeSessionPolicy(opts.policyInput) : null;
  if (typeof opts.policyInput === "string" && policy === null) {
    throw new CliError("E_QUERY_INVALID", "policy must be one of: ephemeral, persistent");
  }
  const leaseTtlMs = typeof opts.leaseTtlMs === "number" ? normalizeSessionLeaseTtlMs(opts.leaseTtlMs) : null;
  if (typeof opts.leaseTtlMs === "number" && leaseTtlMs === null) {
    throw new CliError("E_QUERY_INVALID", "lease-ttl-ms must be a positive integer within supported bounds");
  }

  return await mutateState(async (state) => {
    const sessionId = opts.requestedSessionId
      ? sanitizeSessionId(opts.requestedSessionId)
      : allocateSessionIdForState(state, "s");
    assertSessionDoesNotExist(state, sessionId);
    const debugPort = await allocateFreePort();
    const browserMode = parseManagedBrowserMode(opts.browserModeInput) ?? "headless";
    const session = await startManagedSession(
      {
        sessionId,
        debugPort,
        userDataDir: defaultSessionUserDataDir(sessionId),
        browserMode,
        policy: policy ?? defaultSessionPolicyForKind("managed"),
        createdAt: nowIso(),
      },
      opts.timeoutMs,
    );
    state.sessions[sessionId] =
      leaseTtlMs === null
        ? session
        : withSessionHeartbeat(
            {
              ...session,
              leaseTtlMs,
            },
            session.lastSeenAt,
          );
    state.activeSessionId = sessionId;
    return buildSessionReport(state.sessions[sessionId], {
      active: true,
      created: true,
      restarted: false,
    });
  });
}

export async function sessionAttach(opts: {
  requestedSessionId?: string;
  cdpOriginInput: string;
  timeoutMs: number;
  policyInput?: string;
  leaseTtlMs?: number;
}): Promise<SessionReport> {
  const requestedSessionId = opts.requestedSessionId ? sanitizeSessionId(opts.requestedSessionId) : undefined;
  const cdpOrigin = normalizeCdpOrigin(opts.cdpOriginInput);
  const isAlive = await isCdpEndpointReachable(cdpOrigin, opts.timeoutMs);
  if (!isAlive) {
    throw new CliError("E_CDP_UNREACHABLE", `CDP endpoint is not reachable at ${cdpOrigin}`);
  }
  const policy = typeof opts.policyInput === "string" ? normalizeSessionPolicy(opts.policyInput) : null;
  if (typeof opts.policyInput === "string" && policy === null) {
    throw new CliError("E_QUERY_INVALID", "policy must be one of: ephemeral, persistent");
  }
  const leaseTtlMs = typeof opts.leaseTtlMs === "number" ? normalizeSessionLeaseTtlMs(opts.leaseTtlMs) : null;
  if (typeof opts.leaseTtlMs === "number" && leaseTtlMs === null) {
    throw new CliError("E_QUERY_INVALID", "lease-ttl-ms must be a positive integer within supported bounds");
  }

  return await mutateState(async (state) => {
    const sessionId = requestedSessionId ?? allocateSessionIdForState(state, "a");
    assertSessionDoesNotExist(state, sessionId);
    const attachedAt = nowIso();
    const session: SessionState = {
      sessionId,
      kind: "attached",
      policy: policy ?? defaultSessionPolicyForKind("attached"),
      browserMode: "unknown",
      cdpOrigin,
      debugPort: inferDebugPortFromCdpOrigin(cdpOrigin),
      userDataDir: null,
      browserPid: null,
      ownerId: null,
      leaseExpiresAt: null,
      leaseTtlMs,
      managedUnreachableSince: null,
      managedUnreachableCount: 0,
      createdAt: attachedAt,
      lastSeenAt: attachedAt,
    };
    const hydrated = withSessionHeartbeat(session, attachedAt);
    state.sessions[sessionId] = hydrated;
    state.activeSessionId = sessionId;
    return buildSessionReport(hydrated, {
      active: true,
      created: true,
      restarted: false,
    });
  });
}

export async function sessionUse(opts: { timeoutMs: number; sessionIdInput: string }): Promise<SessionReport> {
  const sessionId = sanitizeSessionId(opts.sessionIdInput);
  const snapshot = readState();
  const existing = snapshot.sessions[sessionId];
  if (!existing) {
    throw new CliError("E_SESSION_NOT_FOUND", `Session ${sessionId} not found`);
  }
  const ensured = await ensureSessionReachable(existing, opts.timeoutMs);

  return await mutateState(async (state) => {
    const current = state.sessions[sessionId];
    if (!current) {
      throw new CliError("E_SESSION_NOT_FOUND", `Session ${sessionId} not found`);
    }
    state.sessions[sessionId] = ensured.session;
    state.activeSessionId = sessionId;
    return buildSessionReport(ensured.session, {
      active: true,
      created: false,
      restarted: ensured.restarted,
    });
  });
}

export function sessionList(): SessionListReport {
  const state = listSessionsSnapshot();
  const sessions = state.sessions.map((session) => ({
    sessionId: session.sessionId,
    kind: session.kind,
    cdpOrigin: session.cdpOrigin,
    browserMode: session.browserMode,
    lastSeenAt: session.lastSeenAt,
  }));
  return {
    ok: true,
    activeSessionId: state.activeSessionId,
    sessions,
  };
}

export async function sessionClearAll(opts: { timeoutMs: number; keepProcesses?: boolean }) {
  return await sessionClear({
    timeoutMs: opts.timeoutMs,
    keepProcesses: Boolean(opts.keepProcesses),
  });
}

export { sessionPrune } from "../state/index.js";
export { sessionCookieCopy } from "../target/public.js";
