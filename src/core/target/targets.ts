import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { allocateFreePort, ensureSessionReachable, startManagedSession } from "../browser.js";
import { CliError } from "../errors.js";
import { withSessionHeartbeat } from "../session/index.js";
import { allocateSessionId, defaultSessionUserDataDir, nowIso, readState, sanitizeSessionId, updateState } from "../state.js";
import { saveTargetSnapshot } from "../state-repos/target-repo.js";
import { extractScopedSnapshotSample } from "./snapshot-sample.js";
import { frameScopeHints, framesForScope, parseFrameScope } from "./target-find.js";
import {
  DEFAULT_IMPLICIT_SESSION_LEASE_TTL_MS,
  type SessionSource,
  type SessionState,
  type TargetListReport,
  type TargetSnapshotReport,
} from "../types.js";

const TARGET_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const SNAPSHOT_TEXT_MAX_CHARS = 1200;
const SNAPSHOT_MAX_HEADINGS = 12;
const SNAPSHOT_MAX_BUTTONS = 12;
const SNAPSHOT_MAX_LINKS = 12;
const SNAPSHOT_MAX_TEXT_CAP = 20000;
const SNAPSHOT_MAX_ITEMS_CAP = 200;

// tsx/esbuild dev transpilation may inject __name(...) wrappers into callbacks
// we pass to frame/page.evaluate. Browser contexts do not define __name, so
// we install a minimal compatibility helper for active and future documents.
const ESBUILD_NAME_COMPAT_SCRIPT = `
if (typeof globalThis.__name !== "function") {
  globalThis.__name = (fn) => fn;
}
`;

const esbuildNameCompatInstalled = new WeakSet<Page>();

async function ensureEvaluateNameCompat(page: Page): Promise<void> {
  if (!esbuildNameCompatInstalled.has(page)) {
    await page.context().addInitScript({ content: ESBUILD_NAME_COMPAT_SCRIPT });
    esbuildNameCompatInstalled.add(page);
  }
  await Promise.all(page.frames().map(async (frame) => frame.evaluate(ESBUILD_NAME_COMPAT_SCRIPT).catch(() => undefined)));
}

function stableTargetId(url: string): string {
  let hash = 0x811c9dc5;
  for (const ch of url) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `t${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function parsePositiveIntInRange(opts: {
  value: number | undefined;
  defaultValue: number;
  min: number;
  max: number;
  name: string;
}): number {
  if (typeof opts.value === "undefined") {
    return opts.defaultValue;
  }

  if (!Number.isFinite(opts.value) || !Number.isInteger(opts.value) || opts.value < opts.min || opts.value > opts.max) {
    throw new CliError("E_QUERY_INVALID", `${opts.name} must be an integer between ${opts.min} and ${opts.max}`);
  }

  return opts.value;
}

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

async function createImplicitManagedSession(timeoutMs: number): Promise<SessionState> {
  return await updateState(async (state) => {
    const sessionId = allocateSessionId(state, "s");
    const debugPort = await allocateFreePort();
    const created = await startManagedSession(
      {
        sessionId,
        debugPort,
        userDataDir: defaultSessionUserDataDir(sessionId),
        policy: "ephemeral",
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
  timeoutMs: number;
  targetIdHint?: string;
  allowImplicitNewSession?: boolean;
}): Promise<{
  session: SessionState;
  sessionSource: SessionSource;
}> {
  const targetIdHint = typeof opts.targetIdHint === "string" && opts.targetIdHint.length > 0 ? sanitizeTargetId(opts.targetIdHint) : null;

  const resolveExplicitSession = async (sessionId: string): Promise<{
    session: SessionState;
    sessionSource: SessionSource;
  }> => {
    const snapshot = readState();
    const existing = snapshot.sessions[sessionId];
    if (!existing) {
      throw new CliError("E_SESSION_NOT_FOUND", `Session ${sessionId} not found`);
    }
    if (targetIdHint) {
      const targetRecord = snapshot.targets[targetIdHint];
      if (!targetRecord) {
        throw new CliError("E_TARGET_SESSION_UNKNOWN", `Target ${targetIdHint} has no recorded session mapping`);
      }
      if (targetRecord.sessionId !== sessionId) {
        throw new CliError("E_TARGET_SESSION_MISMATCH", `Target ${targetIdHint} belongs to session ${targetRecord.sessionId}`);
      }
    }
    const ensured = await ensureSessionReachable(existing, opts.timeoutMs);
    await updateState(async (state) => {
      if (!state.sessions[sessionId]) {
        throw new CliError("E_SESSION_NOT_FOUND", `Session ${sessionId} not found`);
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
      throw new CliError("E_TARGET_SESSION_UNKNOWN", `Target ${targetIdHint} has no recorded session mapping`);
    }
    const sessionId = targetRecord.sessionId;
    return await resolveExplicitSession(sessionId).then((resolved) => ({
      ...resolved,
      sessionSource: "target-inferred",
    }));
  }

  if (opts.allowImplicitNewSession) {
    const session = await createImplicitManagedSession(opts.timeoutMs);
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
    return targetInfo.targetInfo?.targetId ?? stableTargetId(page.url());
  } catch {
    return stableTargetId(page.url());
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
      handles.push({
        page,
        targetId: await readPageTargetId(context, page),
      });
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
  const target = (await listPageTargetHandles(browser)).find((handle) => handle.targetId === targetId);
  if (!target) {
    throw new CliError("E_TARGET_NOT_FOUND", `Target ${targetId} not found in session`);
  }
  await ensureEvaluateNameCompat(target.page);
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

export async function targetSnapshot(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  selectorQuery?: string;
  visibleOnly?: boolean;
  frameScope?: string;
  maxChars?: number;
  maxHeadings?: number;
  maxButtons?: number;
  maxLinks?: number;
}): Promise<TargetSnapshotReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const selectorQuery = normalizeSelectorQuery(opts.selectorQuery);
  const visibleOnly = Boolean(opts.visibleOnly);
  const frameScope = parseFrameScope(opts.frameScope);
  const textMaxChars = parsePositiveIntInRange({
    value: opts.maxChars,
    defaultValue: SNAPSHOT_TEXT_MAX_CHARS,
    min: 1,
    max: SNAPSHOT_MAX_TEXT_CAP,
    name: "max-chars",
  });
  const maxHeadings = parsePositiveIntInRange({
    value: opts.maxHeadings,
    defaultValue: SNAPSHOT_MAX_HEADINGS,
    min: 1,
    max: SNAPSHOT_MAX_ITEMS_CAP,
    name: "max-headings",
  });
  const maxButtons = parsePositiveIntInRange({
    value: opts.maxButtons,
    defaultValue: SNAPSHOT_MAX_BUTTONS,
    min: 1,
    max: SNAPSHOT_MAX_ITEMS_CAP,
    name: "max-buttons",
  });
  const maxLinks = parsePositiveIntInRange({
    value: opts.maxLinks,
    defaultValue: SNAPSHOT_MAX_LINKS,
    min: 1,
    max: SNAPSHOT_MAX_ITEMS_CAP,
    name: "max-links",
  });

  const { session, sessionSource } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: requestedTargetId,
  });
  const resolvedSessionAt = Date.now();
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    const frames = framesForScope(target.page, frameScope);
    const hints = frameScopeHints({
      frameScope,
      frameCount: target.page.frames().length,
      command: "target.snapshot",
      targetId: requestedTargetId,
    });
    if (selectorQuery) {
      for (const frame of frames) {
        try {
          await frame.locator(selectorQuery).count();
        } catch {
          throw new CliError("E_SELECTOR_INVALID", `Invalid selector query: ${selectorQuery}`);
        }
      }
    }

    let scopeMatched = false;
    let totalTextLength = 0;
    let totalHeadings = 0;
    let totalButtons = 0;
    let totalLinks = 0;
    const headings: string[] = [];
    const buttons: string[] = [];
    const links: Array<{ text: string; href: string }> = [];
    let textPreview = "";
    for (const frame of frames) {
      const remainingText = Math.max(0, textMaxChars - textPreview.length);
      const remainingHeadings = Math.max(0, maxHeadings - headings.length);
      const remainingButtons = Math.max(0, maxButtons - buttons.length);
      const remainingLinks = Math.max(0, maxLinks - links.length);
      const sample = await extractScopedSnapshotSample({
        evaluator: frame,
        selectorQuery,
        visibleOnly,
        textMaxChars: Math.max(1, remainingText),
        maxHeadings: Math.max(1, remainingHeadings),
        maxButtons: Math.max(1, remainingButtons),
        maxLinks: Math.max(1, remainingLinks),
      });
      scopeMatched = scopeMatched || sample.scopeMatched;
      totalTextLength += sample.counts.textLength;
      totalHeadings += sample.counts.headings;
      totalButtons += sample.counts.buttons;
      totalLinks += sample.counts.links;
      if (remainingText > 0 && sample.textPreview.length > 0) {
        textPreview = `${textPreview}${textPreview.length > 0 ? "\n" : ""}${sample.textPreview}`.slice(0, textMaxChars);
      }
      if (remainingHeadings > 0 && sample.headings.length > 0) {
        headings.push(...sample.headings.slice(0, remainingHeadings));
      }
      if (remainingButtons > 0 && sample.buttons.length > 0) {
        buttons.push(...sample.buttons.slice(0, remainingButtons));
      }
      if (remainingLinks > 0 && sample.links.length > 0) {
        links.push(...sample.links.slice(0, remainingLinks));
      }
    }
    const actionCompletedAt = Date.now();

    const report: TargetSnapshotReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      url: target.page.url(),
      title: await target.page.title(),
      scope: {
        selector: selectorQuery,
        matched: scopeMatched,
        visibleOnly,
        frameScope,
      },
      textPreview,
      headings,
      buttons,
      links,
      truncated: {
        text: totalTextLength > textMaxChars,
        headings: totalHeadings > maxHeadings,
        buttons: totalButtons > maxButtons,
        links: totalLinks > maxLinks,
      },
      hints,
      timingMs: {
        total: 0,
        resolveSession: resolvedSessionAt - startedAt,
        connectCdp: connectedAt - resolvedSessionAt,
        action: actionCompletedAt - connectedAt,
        persistState: 0,
      },
    };

    const persistStartedAt = Date.now();
    if (opts.persistState !== false) {
      await saveTargetSnapshot({
        targetId: report.targetId,
        sessionId: report.sessionId,
        url: report.url,
        title: report.title,
        status: null,
        updatedAt: nowIso(),
      });
    }
    const persistedAt = Date.now();
    report.timingMs.persistState = persistedAt - persistStartedAt;
    report.timingMs.total = persistedAt - startedAt;

    return report;
  } finally {
    await browser.close();
  }
}
