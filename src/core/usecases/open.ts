import { chromium, type Request, type Response } from "playwright-core";
import { newActionId } from "../action-id.js";
import { CliError } from "../errors.js";
import { resolveOpenSessionHint } from "../session-isolation.js";
import { nowIso } from "../state.js";
import { saveTargetSnapshot } from "../state/index.js";
import { readPageTargetId, resolveSessionForAction } from "../target/targets.js";
import type { OpenReport, SessionReport } from "../types.js";
import { parseManagedBrowserMode } from "./browser-mode.js";

const OPEN_REDIRECT_CHAIN_MAX = 12;

function collectRedirectChain(request: Request): string[] {
  const reverse: string[] = [];
  let current: Request | null = request;
  while (current) {
    reverse.push(current.url());
    current = current.redirectedFrom();
  }
  return reverse.reverse();
}

function buildRedirectEvidence(opts: {
  response: Response | null;
  requestedUrl: string;
  finalUrl: string;
}): { redirectChain: string[] | null; redirectChainTruncated: boolean } {
  if (opts.requestedUrl === opts.finalUrl) {
    return { redirectChain: null, redirectChainTruncated: false };
  }

  const fromResponse = opts.response ? collectRedirectChain(opts.response.request()) : [];
  const merged =
    fromResponse.length > 0
      ? fromResponse
      : [opts.requestedUrl, opts.finalUrl];

  const normalized = merged.filter((entry, idx) => idx === 0 || entry !== merged[idx - 1]);
  if (normalized.length === 0) {
    return { redirectChain: [opts.requestedUrl, opts.finalUrl], redirectChainTruncated: false };
  }

  if (normalized[0] !== opts.requestedUrl) {
    normalized.unshift(opts.requestedUrl);
  }
  if (normalized[normalized.length - 1] !== opts.finalUrl) {
    normalized.push(opts.finalUrl);
  }

  if (normalized.length <= OPEN_REDIRECT_CHAIN_MAX) {
    return { redirectChain: normalized, redirectChainTruncated: false };
  }

  return {
    redirectChain: [...normalized.slice(0, OPEN_REDIRECT_CHAIN_MAX - 1), normalized[normalized.length - 1]],
    redirectChainTruncated: true,
  };
}

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
  const requestedUrl = parsedUrl.toString();
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
        const finalUrl = existing.url();
        const { redirectChain, redirectChainTruncated } = buildRedirectEvidence({
          response: null,
          requestedUrl,
          finalUrl,
        });
        const actionCompletedAt = Date.now();
        const report: OpenReport = {
          ok: true,
          sessionId: session.sessionId,
          sessionSource,
          browserMode: session.browserMode,
          targetId,
          actionId,
          requestedUrl,
          finalUrl,
          wasRedirected: requestedUrl !== finalUrl,
          redirectChain,
          redirectChainTruncated,
          url: finalUrl,
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
    const finalUrl = page.url();
    const { redirectChain, redirectChainTruncated } = buildRedirectEvidence({
      response,
      requestedUrl,
      finalUrl,
    });
    const actionCompletedAt = Date.now();
    const report: OpenReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      browserMode: session.browserMode,
      targetId,
      actionId: newActionId(),
      requestedUrl,
      finalUrl,
      wasRedirected: requestedUrl !== finalUrl,
      redirectChain,
      redirectChainTruncated,
      url: finalUrl,
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
