import { chromium, type Page } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { resolveOpenSessionHint } from "../../session-isolation.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { readPageTargetId, resolveSessionForAction } from "../../target/public.js";
import type { OpenReport, SessionReport } from "../../types.js";
import { parseManagedBrowserMode } from "../app/browser-mode.js";
import { buildActionProofEnvelope, evaluateActionAssertions, parseActionAssertions, toActionWaitEvidence } from "../../shared/index.js";
import { buildRedirectEvidence, navigatePageWithEvidence, parseOpenReuseMode, parseOpenWaitUntil } from "./open-navigation.js";
import { classifyNavigationBlockType } from "../../shared/index.js";

function canReuseActivePageForRequestedUrl(page: Page, requestedUrl: URL): boolean {
  const currentUrl = page.url().trim();
  if (currentUrl.length === 0 || currentUrl === "about:blank") {
    return true;
  }
  try {
    return new URL(currentUrl).origin === requestedUrl.origin;
  } catch {
    return false;
  }
}

export async function openUrl(opts: {
  inputUrl: string;
  timeoutMs: number;
  sessionId?: string;
  profile?: string;
  reuseModeInput?: string;
  waitUntilInput?: string;
  isolation?: string;
  browserModeInput?: string;
  ensureSharedSession: (input: { timeoutMs: number }) => Promise<SessionReport>;
  allowDownload?: boolean;
  downloadOutDir?: string;
  includeProof?: boolean;
  assertUrlPrefix?: string;
  assertSelector?: string;
  assertText?: string;
}): Promise<OpenReport> {
  const startedAt = Date.now();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(opts.inputUrl);
  } catch {
    throw new CliError("E_URL_INVALID", "URL must be absolute (e.g. https://example.com)");
  }
  const requestedUrl = parsedUrl.toString();
  const allowDownload = Boolean(opts.allowDownload);
  const waitUntil = parseOpenWaitUntil(opts.waitUntilInput, allowDownload);
  const reuseMode = parseOpenReuseMode({
    reuseModeInput: opts.reuseModeInput,
  });
  const profileHint = typeof opts.profile === "string" && opts.profile.trim().length > 0 ? opts.profile : undefined;
  const sessionHint = profileHint
    ? undefined
    : await resolveOpenSessionHint({
        sessionId: opts.sessionId,
        isolation: opts.isolation,
        timeoutMs: opts.timeoutMs,
        ensureSharedSession: opts.ensureSharedSession,
      });

  const desiredBrowserMode = parseManagedBrowserMode(opts.browserModeInput);
  const includeProof = Boolean(opts.includeProof);
  const parsedAssertions = parseActionAssertions({
    assertUrlPrefix: opts.assertUrlPrefix,
    assertSelector: opts.assertSelector,
    assertText: opts.assertText,
  });
  const { session, sessionSource } = await resolveSessionForAction({
    sessionHint,
    profileHint,
    timeoutMs: opts.timeoutMs,
    allowImplicitNewSession: !sessionHint && !profileHint,
    browserMode: desiredBrowserMode ?? undefined,
  });
  const resolvedSessionAt = Date.now();
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    if (reuseMode === "url") {
      const existing = context.pages().find((candidate) => candidate.url() === parsedUrl.toString());
      if (existing) {
        const actionId = newActionId();
        const targetId = await readPageTargetId(context, existing);
        const title = await existing.title();
        const finalUrl = existing.url();
        const assertions = await evaluateActionAssertions({
          page: existing,
          assertions: parsedAssertions,
        });
        const block = await classifyNavigationBlockType(existing);
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
          profile: session.profile ?? null,
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
          blockType: block.blockType,
          download: null,
          waitUntil,
          reuseMode,
          reusedTarget: true,
          ...(assertions ? { assertions } : {}),
          ...(includeProof
            ? {
                proofEnvelope: buildActionProofEnvelope({
                  action: "open",
                  urlBefore: requestedUrl,
                  urlAfter: finalUrl,
                  targetBefore: targetId,
                  targetAfter: targetId,
                  wait: toActionWaitEvidence({
                    requested: null,
                    observed: null,
                  }),
                  assertions,
                  details: {
                    waitUntil,
                    reuseMode,
                    reusedTarget: true,
                    status: null,
                    wasRedirected: requestedUrl !== finalUrl,
                    blockType: block.blockType,
                  },
                }),
              }
            : {}),
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
    const existingPages = context.pages();
    const page =
      (() => {
        if (reuseMode === "active" && existingPages.length > 0) {
          const activePage = existingPages[existingPages.length - 1];
          if (canReuseActivePageForRequestedUrl(activePage, parsedUrl)) {
            return activePage;
          }
        }
        if (reuseMode === "origin") {
          const requestedOrigin = parsedUrl.origin;
          const candidate = existingPages
            .slice()
            .reverse()
            .find((entry) => {
              try {
                return new URL(entry.url()).origin === requestedOrigin;
              } catch {
                return false;
              }
            });
          if (candidate) {
            return candidate;
          }
        }
        return null;
      })() ?? (await context.newPage());
    const reusedTarget = existingPages.includes(page);

    const navigation = await navigatePageWithEvidence({
      page,
      parsedUrl,
      timeoutMs: opts.timeoutMs,
      allowDownload,
      downloadOutDir: opts.downloadOutDir,
      waitUntil,
    });

    const targetId = await readPageTargetId(context, page);
    const finalUrl = navigation.finalUrl;
    const assertions = await evaluateActionAssertions({
      page,
      assertions: parsedAssertions,
    });
    const block = await classifyNavigationBlockType(page);
    const { redirectChain, redirectChainTruncated } = buildRedirectEvidence({
      response: navigation.response,
      requestedUrl,
      finalUrl,
    });
    const actionCompletedAt = Date.now();
    const report: OpenReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      browserMode: session.browserMode,
      profile: session.profile ?? null,
      targetId,
      actionId: newActionId(),
      requestedUrl,
      finalUrl,
      wasRedirected: requestedUrl !== finalUrl,
      redirectChain,
      redirectChainTruncated,
      url: finalUrl,
      status: navigation.status,
      title: navigation.title,
      blockType: block.blockType,
      download: navigation.downloadReport,
      waitUntil,
      reuseMode,
      reusedTarget,
      ...(assertions ? { assertions } : {}),
      ...(includeProof
        ? {
            proofEnvelope: buildActionProofEnvelope({
              action: "open",
              urlBefore: requestedUrl,
              urlAfter: finalUrl,
              targetBefore: targetId,
              targetAfter: targetId,
              wait: toActionWaitEvidence({
                requested: null,
                observed: null,
              }),
              assertions,
              details: {
                waitUntil,
                reuseMode,
                reusedTarget,
                status: navigation.status,
                wasRedirected: requestedUrl !== finalUrl,
                blockType: block.blockType,
              },
            }),
          }
        : {}),
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
