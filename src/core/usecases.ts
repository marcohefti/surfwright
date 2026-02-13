import fs from "node:fs";
import { chromium } from "playwright-core";
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
  readState,
  sanitizeSessionId,
  updateState,
  upsertTargetState,
} from "./state.js";
import { readPageTargetId, resolveSessionForAction } from "./targets.js";
import { sessionPrune, stateReconcile, targetPrune } from "./state-maintenance.js";
import type {
  CliContractReport,
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
export function getCliContractReport(version: string): CliContractReport {
  return {
    ok: true,
    name: "surfwright",
    version,
    guarantees: [
      "deterministic output shape",
      "typed failures (code + message)",
      "json compact by default",
      "explicit handles for sessions and targets",
      "bounded runtime via explicit timeouts",
    ],
    commands: [
      {
        id: "doctor",
        usage: "surfwright doctor [--json] [--pretty]",
        summary: "check node/chrome prerequisites without side effects",
      },
      {
        id: "contract",
        usage: "surfwright contract [--json] [--pretty]",
        summary: "emit machine-readable CLI contract and error codes",
      },
      {
        id: "session.ensure",
        usage: "surfwright session ensure [--timeout-ms <ms>] [--json] [--pretty]",
        summary: "reuse active session if reachable; otherwise use managed default",
      },
      {
        id: "session.new",
        usage: "surfwright session new [--session-id <id>] [--timeout-ms <ms>] [--json] [--pretty]",
        summary: "create a managed browser session and mark it active",
      },
      {
        id: "session.attach",
        usage: "surfwright session attach --cdp <origin> [--session-id <id>] [--json] [--pretty]",
        summary: "explicitly attach to an already running CDP endpoint",
      },
      {
        id: "session.use",
        usage: "surfwright session use <sessionId> [--timeout-ms <ms>] [--json] [--pretty]",
        summary: "switch active session after reachability check",
      },
      {
        id: "session.list",
        usage: "surfwright session list [--json] [--pretty]",
        summary: "list known sessions and current active pointer",
      },
      {
        id: "session.prune",
        usage: "surfwright session prune [--drop-managed-unreachable] [--timeout-ms <ms>] [--json] [--pretty]",
        summary: "prune unreachable sessions and repair stale managed pid metadata",
      },
      {
        id: "open",
        usage: "surfwright open <url> [--reuse-url] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
        summary: "open URL and return minimal page report with target handle",
      },
      {
        id: "target.list",
        usage: "surfwright target list [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
        summary: "list current page targets with explicit target handles",
      },
      {
        id: "target.snapshot",
        usage:
          "surfwright target snapshot <targetId> [--selector <query>] [--visible-only] [--max-chars <n>] [--max-headings <n>] [--max-buttons <n>] [--max-links <n>] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
        summary: "read bounded text and UI primitives for a target",
      },
      {
        id: "target.find",
        usage:
          "surfwright target find <targetId> (--text <query> | --selector <query>) [--contains <text>] [--visible-only] [--first] [--limit <n>] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
        summary: "find matching elements by text or selector in a target",
      },
      {
        id: "target.read",
        usage:
          "surfwright target read <targetId> [--selector <query>] [--visible-only] [--chunk-size <n>] [--chunk <n>] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
        summary: "read target text in deterministic chunks",
      },
      {
        id: "target.wait",
        usage:
          "surfwright target wait <targetId> (--for-text <text> | --for-selector <query> | --network-idle) [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
        summary: "wait for deterministic readiness condition on a target",
      },
      {
        id: "target.network",
        usage:
          "surfwright target network <targetId> [--profile <preset>] [--view <mode>] [--fields <csv>] [--capture-ms <ms>] [--max-requests <n>] [--max-websockets <n>] [--max-ws-messages <n>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--include-headers] [--include-post-data] [--no-ws-messages] [--reload] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
        summary: "capture bounded network/websocket diagnostics and performance summary for a target",
      },
      {
        id: "target.network-export",
        usage:
          "surfwright target network-export <targetId> --out <path> [--format har] [--profile <preset>] [--capture-ms <ms>] [--max-requests <n>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--reload] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
        summary: "export filtered network capture as artifact (har)",
      },
      {
        id: "target.network-begin",
        usage:
          "surfwright target network-begin <targetId> [--profile <preset>] [--max-runtime-ms <ms>] [--max-requests <n>] [--max-websockets <n>] [--max-ws-messages <n>] [--include-headers] [--include-post-data] [--no-ws-messages] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
        summary: "start handle-based background network capture for an action window",
      },
      {
        id: "target.network-end",
        usage:
          "surfwright target network-end <captureId> [--profile <preset>] [--view <mode>] [--fields <csv>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--timeout-ms <ms>] [--json] [--pretty]",
        summary: "stop background capture handle and return projected analysis report",
      },
      {
        id: "target.network-export-list",
        usage: "surfwright target network-export-list [--limit <n>] [--json] [--pretty]",
        summary: "list indexed network export artifacts",
      },
      {
        id: "target.prune",
        usage: "surfwright target prune [--max-age-hours <h>] [--max-per-session <n>] [--json] [--pretty]",
        summary: "prune stale/orphan target metadata with age and size caps",
      },
      {
        id: "state.reconcile",
        usage:
          "surfwright state reconcile [--timeout-ms <ms>] [--max-age-hours <h>] [--max-per-session <n>] [--drop-managed-unreachable] [--json] [--pretty]",
        summary: "repair and prune state for resilient post-restart recovery",
      },
    ],
    errors: [
      {
        code: "E_URL_INVALID",
        message: "URL must be absolute (e.g. https://example.com)",
        retryable: false,
      },
      {
        code: "E_SESSION_ID_INVALID",
        message: "sessionId may only contain letters, numbers, dot, underscore, and dash",
        retryable: false,
      },
      {
        code: "E_SESSION_NOT_FOUND",
        message: "Requested session was not found in state",
        retryable: false,
      },
      {
        code: "E_SESSION_EXISTS",
        message: "Session id already exists",
        retryable: false,
      },
      {
        code: "E_SESSION_UNREACHABLE",
        message: "Attached session endpoint is not reachable",
        retryable: true,
      },
      {
        code: "E_SESSION_CONFLICT",
        message: "Reserved default session id has conflicting kind",
        retryable: false,
      },
      {
        code: "E_TARGET_ID_INVALID",
        message: "targetId contains invalid characters",
        retryable: false,
      },
      {
        code: "E_TARGET_NOT_FOUND",
        message: "Requested target was not found in session",
        retryable: false,
      },
      {
        code: "E_QUERY_INVALID",
        message: "Query input is invalid or missing",
        retryable: false,
      },
      {
        code: "E_SELECTOR_INVALID",
        message: "Selector query is invalid",
        retryable: false,
      },
      {
        code: "E_CDP_INVALID",
        message: "CDP URL is invalid",
        retryable: false,
      },
      {
        code: "E_CDP_UNREACHABLE",
        message: "CDP endpoint is not reachable",
        retryable: true,
      },
      {
        code: "E_BROWSER_NOT_FOUND",
        message: "No compatible Chrome/Chromium binary found",
        retryable: false,
      },
      {
        code: "E_BROWSER_START_FAILED",
        message: "Chrome/Chromium process failed to start",
        retryable: true,
      },
      {
        code: "E_BROWSER_START_TIMEOUT",
        message: "CDP endpoint did not become ready in time",
        retryable: true,
      },
      {
        code: "E_STATE_LOCK_TIMEOUT",
        message: "Timed out waiting for state lock",
        retryable: true,
      },
      {
        code: "E_STATE_LOCK_IO",
        message: "State lock file I/O failed",
        retryable: true,
      },
      {
        code: "E_INTERNAL",
        message: "Unexpected runtime failure",
        retryable: true,
      },
    ],
  };
}
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
        const report: OpenReport = {
          ok: true,
          sessionId: session.sessionId,
          targetId: await readPageTargetId(context, existing),
          url: existing.url(),
          status: null,
          title: await existing.title(),
        };
        await upsertTargetState({
          targetId: report.targetId,
          sessionId: report.sessionId,
          url: report.url,
          title: report.title,
          status: report.status,
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
      url: page.url(),
      status: response?.status() ?? null,
      title: await page.title(),
    };
    await upsertTargetState({
      targetId: report.targetId,
      sessionId: report.sessionId,
      url: report.url,
      title: report.title,
      status: report.status,
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
  const state = readState();
  const sessions = Object.values(state.sessions)
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId))
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
export { targetNetworkArtifactList, targetNetworkCaptureBegin, targetNetworkCaptureEnd } from "./target-network-capture.js";
export { targetNetworkExport } from "./target-network-export.js";
export { targetNetwork } from "./target-network.js";
export { targetRead } from "./target-read.js";
export { targetWait } from "./target-wait.js";
export { targetList, targetSnapshot } from "./targets.js";
export { sessionPrune, stateReconcile, targetPrune } from "./state-maintenance.js";
