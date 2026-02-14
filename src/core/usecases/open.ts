import { chromium } from "playwright-core";
import { newActionId } from "../action-id.js";
import { CliError } from "../errors.js";
import { resolveOpenSessionHint } from "../session-isolation.js";
import { nowIso } from "../state.js";
import { saveTargetSnapshot } from "../state-repos/target-repo.js";
import { readPageTargetId, resolveSessionForAction } from "../target/targets.js";
import type { OpenReport, SessionReport } from "../types.js";
import { parseManagedBrowserMode } from "./browser-mode.js";

export async function openUrl(opts: {
  inputUrl: string;
  timeoutMs: number;
  sessionId?: string;
  reuseUrl?: boolean;
  isolation?: string;
  browserModeInput?: string;
  ensureSharedSession: (input: { timeoutMs: number }) => Promise<SessionReport>;
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
    ensureSharedSession: opts.ensureSharedSession,
  });

  const desiredBrowserMode = parseManagedBrowserMode(opts.browserModeInput);
  const { session, sessionSource } = await resolveSessionForAction({
    sessionHint,
    timeoutMs: opts.timeoutMs,
    allowImplicitNewSession: !sessionHint,
    browserMode: desiredBrowserMode ?? undefined,
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
          browserMode: session.browserMode,
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
      browserMode: session.browserMode,
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
