import { chromium } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state.js";
import { saveTargetSnapshot } from "../../state-repos/target-repo.js";
import { extractTargetQueryPreview, parseTargetQueryInput, resolveTargetQueryLocator } from "../target-query.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";
import type { TargetClickExplainReport, TargetClickReport } from "../../types.js";
import {
  explainSelection,
  parseMatchIndex,
  parseWaitAfterClick,
  readPostSnapshot,
  resolveFirstMatch,
  resolveMatchByIndex,
  waitAfterClick,
} from "./click-utils.js";

export async function targetClick(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
  index?: number;
  explain?: boolean;
  waitForText?: string;
  waitForSelector?: string;
  waitNetworkIdle?: boolean;
  snapshot?: boolean;
}): Promise<TargetClickReport | TargetClickExplainReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseTargetQueryInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    containsQuery: opts.containsQuery,
    visibleOnly: opts.visibleOnly,
  });
  const requestedIndex = parseMatchIndex(opts.index);
  const explain = Boolean(opts.explain);
  const waitAfter = parseWaitAfterClick({
    waitForText: opts.waitForText,
    waitForSelector: opts.waitForSelector,
    waitNetworkIdle: opts.waitNetworkIdle,
  });

  if (explain) {
    const hasPostClickEvidence = Boolean(opts.snapshot) || waitAfter !== null;
    if (hasPostClickEvidence) {
      throw new CliError("E_QUERY_INVALID", "--explain cannot be combined with post-click wait options or --snapshot");
    }
  }

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
    const { locator, count } = await resolveTargetQueryLocator({
      page: target.page,
      parsed,
      preferExactText: parsed.mode === "text",
    });

    if (explain) {
      const selection = await explainSelection({
        locator,
        count,
        visibleOnly: parsed.visibleOnly,
        requestedIndex,
      });
      const actionCompletedAt = Date.now();

      const report: TargetClickExplainReport = {
        ok: true,
        sessionId: session.sessionId,
        sessionSource,
        targetId: requestedTargetId,
        mode: parsed.mode,
        selector: parsed.selector,
        contains: parsed.contains,
        visibleOnly: parsed.visibleOnly,
        query: parsed.query,
        matchCount: selection.matchCount,
        requestedIndex: selection.requestedIndex,
        pickedIndex: selection.pickedIndex,
        picked: selection.picked,
        rejected: selection.rejected,
        rejectedTruncated: selection.rejectedTruncated,
        reason: selection.reason,
        url: target.page.url(),
        title: await target.page.title(),
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
    }

    const selected =
      requestedIndex === null
        ? await resolveFirstMatch({
            locator,
            count,
            visibleOnly: parsed.visibleOnly,
          })
        : await resolveMatchByIndex({
            locator,
            count,
            index: requestedIndex,
            visibleOnly: parsed.visibleOnly,
          });

    const preview = await extractTargetQueryPreview(selected.locator);

    await selected.locator.click({
      timeout: opts.timeoutMs,
    });

    await target.page
      .waitForLoadState("domcontentloaded", {
        timeout: Math.max(200, Math.min(1000, opts.timeoutMs)),
      })
      .catch(() => {
        // Not all clicks trigger navigation; this is best-effort only.
      });

    const waited = await waitAfterClick({
      page: target.page as any,
      waitAfter,
      timeoutMs: opts.timeoutMs,
    });

    const postSnapshot = opts.snapshot ? await readPostSnapshot(target.page as any) : null;
    const actionCompletedAt = Date.now();

    const report: TargetClickReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      actionId: newActionId(),
      mode: parsed.mode,
      selector: parsed.selector,
      contains: parsed.contains,
      visibleOnly: parsed.visibleOnly,
      query: parsed.query,
      matchCount: count,
      pickedIndex: selected.index,
      clicked: {
        index: selected.index,
        text: preview.text,
        visible: selected.visible,
        selectorHint: preview.selectorHint,
      },
      url: target.page.url(),
      title: await target.page.title(),
      wait: waited,
      snapshot: postSnapshot,
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
        lastActionId: report.actionId,
        lastActionAt: nowIso(),
        lastActionKind: "click",
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

