import fs from "node:fs";
import {
  allocateFreePort,
  chromeCandidatesForPlatform,
  ensureDefaultManagedSession,
  ensureSessionReachable,
  isCdpEndpointReachable,
  normalizeCdpOrigin,
  startManagedSession,
} from "./browser.js";
import { CliError } from "./errors.js";
import {
  allocateSessionId,
  assertSessionDoesNotExist,
  defaultSessionUserDataDir,
  inferDebugPortFromCdpOrigin,
  nowIso,
  readState,
  sanitizeSessionId,
  updateState,
} from "./state.js";
import {
  defaultSessionPolicyForKind,
  normalizeSessionPolicy,
  normalizeSessionLeaseTtlMs,
  withSessionHeartbeat,
} from "./session/hygiene.js";
import { buildSessionReport } from "./session-report.js";
import { listSessionsSnapshot } from "./state-repos/session-repo.js";
import { sessionClear, sessionPrune } from "./state/maintenance.js";
import type { SessionClearReport } from "./state/maintenance.js";
import type {
  DoctorReport,
  OpenReport,
  SessionListReport,
  SessionReport,
  SessionState,
} from "./types.js";
import { parseManagedBrowserMode } from "./usecases/browser-mode.js";
import { openUrl as openUrlInternal } from "./usecases/open.js";
import { runPipeline as runPipelineInternal } from "./usecases/pipeline.js";
export function getDoctorReport(): DoctorReport {
  const candidates = chromeCandidatesForPlatform();
  const found = candidates.some((candidatePath) => {
    try {
      return fs.existsSync(candidatePath);
    } catch {
      return false;
    }
  });
  return {
    ok: found,
    node: {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    chrome: {
      found,
      candidates,
    },
  };
}
export { getCliContractReport } from "./cli-contract.js";

export function queryInvalid(message: string): CliError {
  return new CliError("E_QUERY_INVALID", message);
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
      return await updateState(async (state) => {
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

  return await updateState(async (state) => {
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

  return await updateState(async (state) => {
    const sessionId = opts.requestedSessionId ? sanitizeSessionId(opts.requestedSessionId) : allocateSessionId(state, "s");
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

  return await updateState(async (state) => {
    const sessionId = requestedSessionId ?? allocateSessionId(state, "a");
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

  return await updateState(async (state) => {
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

export async function sessionClearAll(opts: { timeoutMs: number; keepProcesses?: boolean }): Promise<SessionClearReport> {
  return await sessionClear({
    timeoutMs: opts.timeoutMs,
    keepProcesses: Boolean(opts.keepProcesses),
  });
}

export async function runPipeline(opts: {
  planPath?: string;
  planJson?: string;
  stdinPlan?: string;
  replayPath?: string;
  timeoutMs: number;
  sessionId?: string;
  browserModeInput?: string;
  isolation?: string;
  doctor?: boolean;
  record?: boolean;
  recordPath?: string;
  recordLabel?: string;
}): Promise<Record<string, unknown>> {
  return await runPipelineInternal({
    ...opts,
    ensureSharedSession: async ({ timeoutMs }) =>
      await sessionEnsure({
        timeoutMs,
        browserModeInput: opts.browserModeInput,
      }),
  });
}
export { targetNetwork, targetNetworkArtifactList, targetNetworkArtifactPrune, targetNetworkCaptureBegin, targetNetworkCaptureEnd, targetNetworkCheck, targetNetworkExport, targetNetworkQuery, targetNetworkTail, targetTraceExport, targetTraceInsight } from "../features/network/usecases/index.js";
export { parseFieldsCsv, projectReportFields } from "./report-fields.js";
export { targetClick, targetFill, targetSpawn } from "./target/target-click.js";
export { targetClose, targetEval } from "./target/target-eval.js";
export { targetClickAt, targetEmulate, targetScreenshot } from "./target/target-emulation.js";
export { targetExtract } from "./target/target-extract.js";
export { targetDragDrop, targetFind, targetUpload } from "./target/target-find.js";
export { targetConsoleGet, targetConsoleTail, targetHealth, targetHud } from "./target/target-observability.js";
export { targetFormFill, targetRead } from "./target/target-read.js";
export { targetDialog, targetKeypress, targetWait } from "./target/target-wait.js";
export { targetList, targetSnapshot } from "./target/targets.js";
export { targetFrames } from "./target/frames/target-frames.js";
export { targetUrlAssert } from "./target/url/url-assert.js";
export { targetObserve } from "./target/effects/target-observe.js";
export { targetHover, targetMotionDetect, targetStickyCheck } from "./target/effects/target-effect-assertions.js";
export { targetScrollRevealScan, targetTransitionAssert } from "./target/effects/target-effect-assertions-advanced.js";
export { targetScrollPlan } from "./target/effects/target-scroll-plan.js";
export { targetScrollSample } from "./target/effects/target-scroll-sample.js";
export { targetScrollWatch } from "./target/effects/target-scroll-watch.js";
export { targetTransitionTrace } from "./target/effects/target-transition-trace.js";
export { sessionPrune, stateReconcile, targetPrune } from "./state/maintenance.js";
export { sessionCookieCopy } from "./target/effects/session-cookie-copy.js";
export { extensionList, extensionLoad, extensionReload, extensionUninstall } from "./extensions/index.js";
