import fs from "node:fs";
import { chromium } from "playwright-core";
import { newActionId } from "./action-id.js";
import {
  CDP_HEALTHCHECK_TIMEOUT_MS,
  allocateFreePort,
  chromeCandidatesForPlatform,
  ensureDefaultManagedSession,
  ensureSessionReachable,
  isCdpEndpointAlive,
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
  sanitizeSessionId,
  updateState,
} from "./state.js";
import { listSessionsSnapshot } from "./state-repos/session-repo.js";
import { saveTargetSnapshot } from "./state-repos/target-repo.js";
import { readPageTargetId, resolveSessionForAction } from "./targets.js";
import { sessionPrune, stateReconcile, targetPrune } from "./state-maintenance.js";
import type {
  DoctorReport,
  OpenReport,
  SessionListReport,
  SessionReport,
  SessionState,
} from "./types.js";
function sessionReport(
  session: SessionState,
  meta: {
    active: boolean;
    created: boolean;
    restarted: boolean;
  },
): SessionReport {
  return {
    ok: true,
    sessionId: session.sessionId,
    kind: session.kind,
    cdpOrigin: session.cdpOrigin,
    active: meta.active,
    created: meta.created,
    restarted: meta.restarted,
  };
}
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
}): Promise<OpenReport> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(opts.inputUrl);
  } catch {
    throw new CliError("E_URL_INVALID", "URL must be absolute (e.g. https://example.com)");
  }
  const { session } = await resolveSessionForAction(opts.sessionId, opts.timeoutMs);
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    if (opts.reuseUrl) {
      const existing = context.pages().find((candidate) => candidate.url() === parsedUrl.toString());
      if (existing) {
        const actionId = newActionId();
        const report: OpenReport = {
          ok: true,
          sessionId: session.sessionId,
          targetId: await readPageTargetId(context, existing),
          actionId,
          url: existing.url(),
          status: null,
          title: await existing.title(),
        };
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
        return report;
      }
    }
    const page = await context.newPage();
    const response = await page.goto(parsedUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: opts.timeoutMs,
    });
    const targetId = await readPageTargetId(context, page);
    const report: OpenReport = {
      ok: true,
      sessionId: session.sessionId,
      targetId,
      actionId: newActionId(),
      url: page.url(),
      status: response?.status() ?? null,
      title: await page.title(),
    };
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
    return report;
  } finally {
    await browser.close();
  }
}
export async function sessionEnsure(opts: { timeoutMs: number }): Promise<SessionReport> {
  return await updateState(async (state) => {
    if (state.activeSessionId && state.sessions[state.activeSessionId]) {
      const activeId = state.activeSessionId;
      const activeSession = state.sessions[activeId];
      try {
        const ensured = await ensureSessionReachable(activeSession, opts.timeoutMs);
        state.sessions[activeId] = ensured.session;
        state.activeSessionId = activeId;
        return sessionReport(ensured.session, {
          active: true,
          created: false,
          restarted: ensured.restarted,
        });
      } catch (error) {
        if (!(error instanceof CliError) || error.code !== "E_SESSION_UNREACHABLE" || activeSession.kind !== "attached") {
          throw error;
        }
        // Guardrail: never auto-attach to unknown running browsers. If an attached session is dead,
        // fallback to a managed default session instead of probing/attaching elsewhere.
      }
    }
    const ensuredDefault = await ensureDefaultManagedSession(state, opts.timeoutMs);
    state.activeSessionId = ensuredDefault.session.sessionId;
    return sessionReport(ensuredDefault.session, {
      active: true,
      created: ensuredDefault.created,
      restarted: ensuredDefault.restarted,
    });
  });
}
export async function sessionNew(opts: { timeoutMs: number; requestedSessionId?: string }): Promise<SessionReport> {
  return await updateState(async (state) => {
    const sessionId = opts.requestedSessionId ? sanitizeSessionId(opts.requestedSessionId) : allocateSessionId(state, "s");
    assertSessionDoesNotExist(state, sessionId);
    const debugPort = await allocateFreePort();
    const session = await startManagedSession(
      {
        sessionId,
        debugPort,
        userDataDir: defaultSessionUserDataDir(sessionId),
        createdAt: nowIso(),
      },
      opts.timeoutMs,
    );
    state.sessions[sessionId] = session;
    state.activeSessionId = sessionId;
    return sessionReport(session, {
      active: true,
      created: true,
      restarted: false,
    });
  });
}
export async function sessionAttach(opts: { requestedSessionId?: string; cdpOriginInput: string }): Promise<SessionReport> {
  return await updateState(async (state) => {
    const sessionId = opts.requestedSessionId ? sanitizeSessionId(opts.requestedSessionId) : allocateSessionId(state, "a");
    assertSessionDoesNotExist(state, sessionId);
    const cdpOrigin = normalizeCdpOrigin(opts.cdpOriginInput);
    const isAlive = await isCdpEndpointAlive(cdpOrigin, CDP_HEALTHCHECK_TIMEOUT_MS);
    if (!isAlive) {
      throw new CliError("E_CDP_UNREACHABLE", `CDP endpoint is not reachable at ${cdpOrigin}`);
    }
    const session: SessionState = {
      sessionId,
      kind: "attached",
      cdpOrigin,
      debugPort: inferDebugPortFromCdpOrigin(cdpOrigin),
      userDataDir: null,
      browserPid: null,
      createdAt: nowIso(),
      lastSeenAt: nowIso(),
    };
    state.sessions[sessionId] = session;
    state.activeSessionId = sessionId;
    return sessionReport(session, {
      active: true,
      created: true,
      restarted: false,
    });
  });
}
export async function sessionUse(opts: { timeoutMs: number; sessionIdInput: string }): Promise<SessionReport> {
  return await updateState(async (state) => {
    const sessionId = sanitizeSessionId(opts.sessionIdInput);
    const existing = state.sessions[sessionId];
    if (!existing) {
      throw new CliError("E_SESSION_NOT_FOUND", `Session ${sessionId} not found`);
    }
    const ensured = await ensureSessionReachable(existing, opts.timeoutMs);
    state.sessions[sessionId] = ensured.session;
    state.activeSessionId = sessionId;
    return sessionReport(ensured.session, {
      active: true,
      created: false,
      restarted: ensured.restarted,
    });
  });
}
export function sessionList(): SessionListReport {
  const state = listSessionsSnapshot();
  const sessions = state.sessions
    .map((session) => ({
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
export { targetFind } from "./target-find.js";
export {
  targetNetwork,
  targetNetworkArtifactList,
  targetNetworkArtifactPrune,
  targetNetworkCaptureBegin,
  targetNetworkCaptureEnd,
  targetNetworkCheck,
  targetNetworkExport,
  targetNetworkQuery,
  targetNetworkTail,
} from "../features/network/usecases/index.js";
export { targetRead } from "./target-read.js";
export { targetWait } from "./target-wait.js";
export { targetList, targetSnapshot } from "./targets.js";
export { sessionPrune, stateReconcile, targetPrune } from "./state-maintenance.js";
