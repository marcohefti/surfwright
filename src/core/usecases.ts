import fs from "node:fs";
import { chromium } from "playwright-core";
import { newActionId } from "./action-id.js";
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
import { resolveOpenSessionHint, resolvePipelineSessionId } from "./session-isolation.js";
import { parseFieldsCsv, projectReportFields } from "./report-fields.js";
import { listSessionsSnapshot } from "./state-repos/session-repo.js";
import { saveTargetSnapshot } from "./state-repos/target-repo.js";
import { targetClick, targetFill, targetSpawn } from "./target/target-click.js";
import { targetClose, targetEval } from "./target/target-eval.js";
import { targetEmulate, targetScreenshot } from "./target/target-emulation.js";
import { targetExtract } from "./target/target-extract.js";
import { targetDragDrop, targetFind, targetUpload } from "./target/target-find.js";
import { targetObserve } from "./target/effects/target-observe.js";
import {
  targetHover,
  targetMotionDetect,
  targetStickyCheck,
} from "./target/effects/target-effect-assertions.js";
import { targetScrollRevealScan, targetTransitionAssert } from "./target/effects/target-effect-assertions-advanced.js";
import { targetScrollPlan } from "./target/effects/target-scroll-plan.js";
import { targetScrollSample } from "./target/effects/target-scroll-sample.js";
import { targetScrollWatch } from "./target/effects/target-scroll-watch.js";
import { targetTransitionTrace } from "./target/effects/target-transition-trace.js";
import { targetConsoleGet, targetConsoleTail, targetHealth, targetHud } from "./target/target-observability.js";
import { targetFormFill, targetRead } from "./target/target-read.js";
import { targetDialog, targetKeypress, targetWait } from "./target/target-wait.js";
import { readPageTargetId, resolveSessionForAction, targetList, targetSnapshot } from "./target/targets.js";
import { sessionClear, sessionPrune, stateReconcile, targetPrune } from "./state/maintenance.js";
import type { SessionClearReport } from "./state/maintenance.js";
import { executePipelinePlan } from "./pipeline.js";
import type {
  DoctorReport,
  OpenReport,
  SessionListReport,
  SessionReport,
  SessionState,
} from "./types.js";
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

export async function openUrl(opts: {
  inputUrl: string;
  timeoutMs: number;
  sessionId?: string;
  reuseUrl?: boolean;
  isolation?: string;
}): Promise<OpenReport> {
  const startedAt = Date.now();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(opts.inputUrl);
  } catch {
    throw new CliError("E_URL_INVALID", "URL must be absolute (e.g. https://example.com)");
  }
  const sessionHint = await resolveOpenSessionHint({
    sessionId: opts.sessionId,
    isolation: opts.isolation,
    timeoutMs: opts.timeoutMs,
    ensureSharedSession: async ({ timeoutMs }) =>
      await sessionEnsure({
        timeoutMs,
      }),
  });

  const { session, sessionSource } = await resolveSessionForAction({
    sessionHint,
    timeoutMs: opts.timeoutMs,
    allowImplicitNewSession: !sessionHint,
  });
  const resolvedSessionAt = Date.now();
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    if (opts.reuseUrl) {
      const existing = context.pages().find((candidate) => candidate.url() === parsedUrl.toString());
      if (existing) {
        const actionId = newActionId();
        const targetId = await readPageTargetId(context, existing);
        const title = await existing.title();
        const actionCompletedAt = Date.now();
        const report: OpenReport = {
          ok: true,
          sessionId: session.sessionId,
          sessionSource,
          targetId,
          actionId,
          url: existing.url(),
          status: null,
          title,
          timingMs: {
            total: 0,
            resolveSession: resolvedSessionAt - startedAt,
            connectCdp: connectedAt - resolvedSessionAt,
            action: actionCompletedAt - connectedAt,
            persistState: 0,
          },
        };
        const persistStartedAt = Date.now();
        await saveTargetSnapshot({
          targetId: report.targetId,
          sessionId: report.sessionId,
          url: report.url,
          title: report.title,
          status: report.status,
          lastActionId: report.actionId,
          lastActionAt: nowIso(),
          lastActionKind: "open",
          updatedAt: nowIso(),
        });
        const persistedAt = Date.now();
        report.timingMs.persistState = persistedAt - persistStartedAt;
        report.timingMs.total = persistedAt - startedAt;
        return report;
      }
    }
    const page = await context.newPage();
    const response = await page.goto(parsedUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: opts.timeoutMs,
    });
    const targetId = await readPageTargetId(context, page);
    const title = await page.title();
    const actionCompletedAt = Date.now();
    const report: OpenReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId,
      actionId: newActionId(),
      url: page.url(),
      status: response?.status() ?? null,
      title,
      timingMs: {
        total: 0,
        resolveSession: resolvedSessionAt - startedAt,
        connectCdp: connectedAt - resolvedSessionAt,
        action: actionCompletedAt - connectedAt,
        persistState: 0,
      },
    };
    const persistStartedAt = Date.now();
    await saveTargetSnapshot({
      targetId: report.targetId,
      sessionId: report.sessionId,
      url: report.url,
      title: report.title,
      status: report.status,
      lastActionId: report.actionId,
      lastActionAt: nowIso(),
      lastActionKind: "open",
      updatedAt: nowIso(),
    });
    const persistedAt = Date.now();
    report.timingMs.persistState = persistedAt - persistStartedAt;
    report.timingMs.total = persistedAt - startedAt;
    return report;
  } finally {
    await browser.close();
  }
}
export async function sessionEnsure(opts: { timeoutMs: number }): Promise<SessionReport> {
  await sessionPrune({
    timeoutMs: opts.timeoutMs,
    dropManagedUnreachable: false,
  });

  const snapshot = readState();
  if (snapshot.activeSessionId && snapshot.sessions[snapshot.activeSessionId]) {
    const activeId = snapshot.activeSessionId;
    const activeSession = snapshot.sessions[activeId];
    try {
      const ensured = await ensureSessionReachable(activeSession, opts.timeoutMs);
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
    const ensuredDefault = await ensureDefaultManagedSession(state, opts.timeoutMs);
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
    const session = await startManagedSession(
      {
        sessionId,
        debugPort,
        userDataDir: defaultSessionUserDataDir(sessionId),
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
  isolation?: string;
  doctor?: boolean;
  record?: boolean;
  recordPath?: string;
  recordLabel?: string;
}): Promise<Record<string, unknown>> {
  const sourceCount =
    Number(typeof opts.planPath === "string" && opts.planPath.length > 0) +
    Number(typeof opts.planJson === "string" && opts.planJson.length > 0) +
    Number(typeof opts.replayPath === "string" && opts.replayPath.length > 0);
  if (sourceCount !== 1) {
    throw new CliError("E_QUERY_INVALID", "Use exactly one plan source: --plan, --plan-json, or --replay");
  }
  const resolvedSessionId = opts.doctor
    ? opts.sessionId
    : await resolvePipelineSessionId({
        sessionId: opts.sessionId,
        isolation: opts.isolation,
        timeoutMs: opts.timeoutMs,
        ensureSharedSession: async ({ timeoutMs }) => await sessionEnsure({ timeoutMs }),
        ensureImplicitSession: async ({ timeoutMs }) => await resolveSessionForAction({ timeoutMs, allowImplicitNewSession: true }),
      });

  return await executePipelinePlan({
    planPath: opts.planPath,
    planJson: opts.planJson,
    stdinPlan: opts.stdinPlan,
    replayPath: opts.replayPath,
    timeoutMs: opts.timeoutMs,
    sessionId: resolvedSessionId,
    doctor: Boolean(opts.doctor),
    record: Boolean(opts.record),
    recordPath: opts.recordPath,
    recordLabel: opts.recordLabel,
    ops: {
      open: async (input) => await openUrl({ inputUrl: input.url, timeoutMs: input.timeoutMs, sessionId: input.sessionId, reuseUrl: input.reuseUrl }),
      list: async (input) => (await targetList({ timeoutMs: input.timeoutMs, sessionId: input.sessionId, persistState: input.persistState })) as unknown as Record<string, unknown>,
      snapshot: async (input) =>
        (await targetSnapshot({
          targetId: input.targetId, timeoutMs: input.timeoutMs, sessionId: input.sessionId, selectorQuery: input.selectorQuery, visibleOnly: input.visibleOnly, frameScope: input.frameScope, persistState: input.persistState,
        })) as unknown as Record<string, unknown>,
      find: async (input) =>
        (await targetFind({
          targetId: input.targetId, timeoutMs: input.timeoutMs, sessionId: input.sessionId, textQuery: input.textQuery, selectorQuery: input.selectorQuery, containsQuery: input.containsQuery, visibleOnly: input.visibleOnly, first: input.first, limit: input.limit, persistState: input.persistState,
        })) as unknown as Record<string, unknown>,
      click: async (input) =>
        (await targetClick({
          targetId: input.targetId, timeoutMs: input.timeoutMs, sessionId: input.sessionId, textQuery: input.textQuery, selectorQuery: input.selectorQuery, containsQuery: input.containsQuery, visibleOnly: input.visibleOnly, waitForText: input.waitForText, waitForSelector: input.waitForSelector, waitNetworkIdle: input.waitNetworkIdle, snapshot: input.snapshot, persistState: input.persistState,
        })) as unknown as Record<string, unknown>,
      read: async (input) =>
        (await targetRead({
          targetId: input.targetId, timeoutMs: input.timeoutMs, sessionId: input.sessionId, selectorQuery: input.selectorQuery, visibleOnly: input.visibleOnly, frameScope: input.frameScope, chunkSize: input.chunkSize, chunkIndex: input.chunkIndex, persistState: input.persistState,
        })) as unknown as Record<string, unknown>,
      extract: async (input) =>
        (await targetExtract({
          targetId: input.targetId, timeoutMs: input.timeoutMs, sessionId: input.sessionId, kind: input.kind, selectorQuery: input.selectorQuery, visibleOnly: input.visibleOnly, frameScope: input.frameScope, limit: input.limit, persistState: input.persistState,
        })) as unknown as Record<string, unknown>,
      eval: async (input) =>
        (await targetEval({
          targetId: input.targetId, timeoutMs: input.timeoutMs, sessionId: input.sessionId, expression: input.expression, argJson: input.argJson, captureConsole: input.captureConsole, maxConsole: input.maxConsole, persistState: input.persistState,
        })) as unknown as Record<string, unknown>,
      wait: async (input) =>
        (await targetWait({
          targetId: input.targetId, timeoutMs: input.timeoutMs, sessionId: input.sessionId, forText: input.forText, forSelector: input.forSelector, networkIdle: input.networkIdle, persistState: input.persistState,
        })) as unknown as Record<string, unknown>,
    },
  });
}
export { targetNetwork, targetNetworkArtifactList, targetNetworkArtifactPrune, targetNetworkCaptureBegin, targetNetworkCaptureEnd, targetNetworkCheck, targetNetworkExport, targetNetworkQuery, targetNetworkTail, targetTraceExport, targetTraceInsight } from "../features/network/usecases/index.js";
export { parseFieldsCsv, projectReportFields } from "./report-fields.js";
export { targetFind, targetRead, targetWait, targetClick, targetFill, targetFormFill, targetUpload, targetKeypress, targetDragDrop, targetSpawn, targetClose, targetDialog, targetEmulate, targetScreenshot, targetEval, targetList, targetSnapshot, targetExtract };
export { targetConsoleGet, targetConsoleTail, targetHealth, targetHover, targetHud, targetMotionDetect, targetObserve, targetScrollPlan, targetScrollRevealScan, targetScrollSample, targetScrollWatch, targetStickyCheck, targetTransitionAssert, targetTransitionTrace };
export { sessionPrune, stateReconcile, targetPrune } from "./state/maintenance.js";
export { sessionCookieCopy } from "./target/effects/session-cookie-copy.js";
