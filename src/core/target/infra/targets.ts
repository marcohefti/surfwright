import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { allocateFreePort, ensureSessionReachable, startManagedSession } from "../../browser.js";
import { CliError } from "../../errors.js";
import { ensureProfileManagedSession } from "../../profile/index.js";
import { withSessionHeartbeat } from "../../session/index.js";
import { defaultSessionUserDataDir, nowIso, readState, sanitizeSessionId } from "../../state/index.js";
import { allocateSessionIdForState, mutateState, saveTargetSnapshot } from "../../state/index.js";
import {
  DEFAULT_IMPLICIT_SESSION_LEASE_TTL_MS,
  type ManagedBrowserMode,
  type SessionSource,
  type SessionState,
  type TargetListReport,
} from "../../types.js";

const TARGET_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export function sanitizeTargetId(input: string): string {
  const value = input.trim();
  if (!TARGET_ID_PATTERN.test(value)) {
    throw new CliError(
      "E_TARGET_ID_INVALID",
      "targetId may only contain letters, numbers, dot, underscore, colon, and dash",
    );
  }
  return value;
}

export function normalizeSelectorQuery(input: string | undefined): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const value = input.trim();
  if (value.length === 0) {
    throw new CliError("E_QUERY_INVALID", "selector query must not be empty");
  }
  return value;
}

export async function ensureValidSelector(page: Page, selectorQuery: string): Promise<void> {
  try {
    await page.locator(selectorQuery).count();
  } catch {
    throw new CliError("E_SELECTOR_INVALID", `Invalid selector query: ${selectorQuery}`);
  }
}

async function createImplicitManagedSession(timeoutMs: number, browserMode: ManagedBrowserMode | undefined): Promise<SessionState> {
  return await mutateState(async (state) => {
    const sessionId = allocateSessionIdForState(state, "s");
    const debugPort = await allocateFreePort();
    const created = await startManagedSession(
      {
        sessionId,
        debugPort,
        userDataDir: defaultSessionUserDataDir(sessionId),
        policy: "ephemeral",
        browserMode: browserMode ?? "headless",
        createdAt: nowIso(),
      },
      timeoutMs,
    );
    const session = withSessionHeartbeat(
      {
        ...created,
        policy: "ephemeral",
        leaseTtlMs: DEFAULT_IMPLICIT_SESSION_LEASE_TTL_MS,
      },
      created.lastSeenAt,
    );
    state.sessions[sessionId] = session;
    state.activeSessionId = sessionId;
    return session;
  });
}

export async function resolveSessionForAction(opts: {
  sessionHint?: string;
  profileHint?: string;
  timeoutMs: number;
  targetIdHint?: string;
  allowImplicitNewSession?: boolean;
  browserMode?: ManagedBrowserMode;
}): Promise<{
  session: SessionState;
  sessionSource: SessionSource;
}> {
  const targetIdHint = typeof opts.targetIdHint === "string" && opts.targetIdHint.length > 0 ? sanitizeTargetId(opts.targetIdHint) : null;

  const buildSessionNotFoundError = (sessionId: string): CliError => {
    const snapshot = readState();
    return new CliError("E_SESSION_NOT_FOUND", `Session ${sessionId} not found`, {
      hints: [
        "Run `surfwright session list` to inspect active/known sessions",
        "If no suitable session exists, run `surfwright session ensure` (or `session new`)",
        "If this came from a stale target, reacquire targetId via `surfwright target list --session <id>`",
      ],
      hintContext: {
        requestedSessionId: sessionId,
        activeSessionId: snapshot.activeSessionId ?? null,
        knownSessionCount: Object.keys(snapshot.sessions).length,
        targetHint: targetIdHint ?? null,
      },
    });
  };

  const buildTargetSessionUnknownError = (targetId: string): CliError => {
    const snapshot = readState();
    return new CliError("E_TARGET_SESSION_UNKNOWN", `Target ${targetId} has no recorded session mapping`, {
      hints: [
        "Reacquire a live targetId with `surfwright target list --session <id>`",
        "If needed, open/reopen the page first with `surfwright open <url>`",
      ],
      hintContext: {
        requestedTargetId: targetId,
        activeSessionId: snapshot.activeSessionId ?? null,
        knownTargetCount: Object.keys(snapshot.targets).length,
      },
    });
  };

  if (typeof opts.profileHint === "string" && opts.profileHint.trim().length > 0) {
    if (typeof opts.sessionHint === "string" && opts.sessionHint.trim().length > 0) {
      throw new CliError("E_QUERY_INVALID", "Use either --session or --profile (not both)");
    }
    if (targetIdHint) {
      throw new CliError("E_QUERY_INVALID", "--profile is not allowed when targetId implies a session mapping");
    }
    const ensured = await ensureProfileManagedSession({
      profileInput: opts.profileHint,
      timeoutMs: opts.timeoutMs,
      browserMode: opts.browserMode,
    });
    await mutateState(async (state) => {
      state.sessions[ensured.session.sessionId] = ensured.session;
      state.activeSessionId = ensured.session.sessionId;
    });
    return {
      session: ensured.session,
      sessionSource: "explicit",
    };
  }

  const resolveExplicitSession = async (sessionId: string): Promise<{
    session: SessionState;
    sessionSource: SessionSource;
  }> => {
    const snapshot = readState();
    const existing = snapshot.sessions[sessionId];
    if (!existing) {
      throw buildSessionNotFoundError(sessionId);
    }
    if (targetIdHint) {
      const targetRecord = snapshot.targets[targetIdHint];
      if (!targetRecord) {
        throw buildTargetSessionUnknownError(targetIdHint);
      }
      if (targetRecord.sessionId !== sessionId) {
        throw new CliError("E_TARGET_SESSION_MISMATCH", `Target ${targetIdHint} belongs to session ${targetRecord.sessionId}`);
      }
    }
    const ensured = await ensureSessionReachable(
      existing,
      opts.timeoutMs,
      opts.browserMode ? { browserMode: opts.browserMode } : undefined,
    );
    await mutateState(async (state) => {
      if (!state.sessions[sessionId]) {
        throw buildSessionNotFoundError(sessionId);
      }
      state.sessions[sessionId] = ensured.session;
      state.activeSessionId = sessionId;
    });
    return {
      session: ensured.session,
      sessionSource: "explicit",
    };
  };

  if (typeof opts.sessionHint === "string" && opts.sessionHint.length > 0) {
    const sessionId = sanitizeSessionId(opts.sessionHint);
    return await resolveExplicitSession(sessionId);
  }

  if (targetIdHint) {
    const snapshot = readState();
    const targetRecord = snapshot.targets[targetIdHint];
    if (!targetRecord) {
      throw buildTargetSessionUnknownError(targetIdHint);
    }
    const sessionId = targetRecord.sessionId;
    return await resolveExplicitSession(sessionId).then((resolved) => ({
      ...resolved,
      sessionSource: "target-inferred",
    }));
  }

  if (opts.allowImplicitNewSession) {
    const session = await createImplicitManagedSession(opts.timeoutMs, opts.browserMode);
    return {
      session,
      sessionSource: "implicit-new",
    };
  }

  throw new CliError(
    "E_SESSION_REQUIRED",
    "session is required for this command when target session cannot be inferred",
  );
}

export async function readPageTargetId(context: BrowserContext, page: Page): Promise<string> {
  try {
    const cdpSession = await context.newCDPSession(page);
    const targetInfo = (await cdpSession.send("Target.getTargetInfo")) as {
      targetInfo?: { targetId?: string };
    };
    const targetId = targetInfo.targetInfo?.targetId;
    if (typeof targetId !== "string" || targetId.trim().length === 0) {
      throw new CliError("E_INTERNAL", "CDP did not return a targetId for page");
    }
    return targetId;
  } catch {
    throw new CliError("E_INTERNAL", "Unable to resolve targetId handle from CDP");
  }
}

export async function listPageTargetHandles(
  browser: Browser,
): Promise<
  Array<{
    page: Page;
    targetId: string;
  }>
> {
  const handles: Array<{
    page: Page;
    targetId: string;
  }> = [];

  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      try {
        handles.push({
          page,
          targetId: await readPageTargetId(context, page),
        });
      } catch {
        // Prefer dropping unidentified pages over generating ambiguous fallback handles.
      }
    }
  }

  return handles;
}

export async function resolveTargetHandle(
  browser: Browser,
  targetId: string,
): Promise<{
  page: Page;
  targetId: string;
}> {
  const handles = await listPageTargetHandles(browser);
  const target = handles.find((handle) => handle.targetId === targetId);
  if (!target) {
    const snapshot = readState();
    const known = snapshot.targets[targetId];
    const replacementByUrl =
      known && typeof known.url === "string" && known.url.length > 0
        ? handles.filter((entry) => entry.page.url() === known.url)
        : [];
    const replacement = replacementByUrl.length === 1 ? replacementByUrl[0] : null;
    const hints: string[] = [
      "Target handle can change after navigation/new tab/reload; reacquire with `target list`",
      replacement ? `Possible replacement targetId: ${replacement.targetId}` : "Retry by reopening the page with `open <url>`",
    ];
    if (replacement) {
      hints.push(`Retry original command with positional targetId ${replacement.targetId}`);
    }
    throw new CliError("E_TARGET_NOT_FOUND", `Target ${targetId} not found in session`, {
      hints,
      hintContext: {
        requestedTargetId: targetId,
        knownUrl: known?.url ?? null,
        activeTargets: handles.length,
        sampleTargetIds: handles.slice(0, 6).map((entry) => entry.targetId).join(","),
        replacementTargetId: replacement?.targetId ?? null,
      },
    });
  }
  return target;
}

export async function targetList(opts: { timeoutMs: number; sessionId?: string; persistState?: boolean }): Promise<TargetListReport> {
  const startedAt = Date.now();
  const { session, sessionSource } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
  });
  const resolvedSessionAt = Date.now();
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();

  try {
    const handles = await listPageTargetHandles(browser);
    const targets: TargetListReport["targets"] = [];
    for (const handle of handles) {
      targets.push({
        targetId: handle.targetId,
        url: handle.page.url(),
        title: await handle.page.title(),
        type: "page",
      });
    }
    const actionCompletedAt = Date.now();
    targets.sort((a, b) => a.targetId.localeCompare(b.targetId));

    const persistStartedAt = Date.now();
    if (opts.persistState !== false) {
      for (const target of targets) {
        await saveTargetSnapshot({
          targetId: target.targetId,
          sessionId: session.sessionId,
          url: target.url,
          title: target.title,
          status: null,
          updatedAt: nowIso(),
        });
      }
    }
    const persistedAt = Date.now();

    return {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targets,
      timingMs: {
        total: persistedAt - startedAt,
        resolveSession: resolvedSessionAt - startedAt,
        connectCdp: connectedAt - resolvedSessionAt,
        action: actionCompletedAt - connectedAt,
        persistState: persistedAt - persistStartedAt,
      },
    };
  } finally {
    await browser.close();
  }
}
