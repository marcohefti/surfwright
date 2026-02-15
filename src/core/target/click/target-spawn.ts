import { chromium } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state.js";
import { saveTargetSnapshot } from "../../state-repos/target-repo.js";
import { parseTargetQueryInput, resolveTargetQueryLocator } from "../target-query.js";
import { readPageTargetId, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";

type TargetSpawnReport = {
  ok: true;
  sessionId: string;
  parentTargetId: string;
  childTargetId: string;
  actionId: string;
  query: string;
  url: string;
  title: string;
  timingMs: {
    total: number;
    resolveSession: number;
    connectCdp: number;
    action: number;
    persistState: number;
  };
};

export async function targetSpawn(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
}): Promise<TargetSpawnReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseTargetQueryInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    containsQuery: opts.containsQuery,
    visibleOnly: opts.visibleOnly,
  });

  const { session } = await resolveSessionForAction({
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
    const parent = await resolveTargetHandle(browser, requestedTargetId);
    const context = parent.page.context();
    const beforePages = context.pages();

    const { locator, count } = await resolveTargetQueryLocator({
      page: parent.page,
      parsed,
      preferExactText: parsed.mode === "text",
    });

    // Match selection follows the click logic: first matching element (optionally visible-only).
    let selectedLocator = locator.first();
    let selectedIndex = -1;
    for (let idx = 0; idx < count; idx += 1) {
      const candidate = locator.nth(idx);
      let visible = false;
      try {
        visible = await candidate.isVisible();
      } catch {
        visible = false;
      }
      if (parsed.visibleOnly && !visible) {
        continue;
      }
      selectedLocator = candidate;
      selectedIndex = idx;
      break;
    }
    if (selectedIndex < 0) {
      throw new CliError("E_QUERY_INVALID", parsed.visibleOnly ? "No visible element matched spawn query" : "No element matched spawn query");
    }

    const childPagePromise = context.waitForEvent("page", {
      timeout: opts.timeoutMs,
    });
    await selectedLocator.click({
      timeout: opts.timeoutMs,
    });

    let childPage: (typeof beforePages)[number] | null = null;
    try {
      childPage = await childPagePromise;
    } catch {
      const pagesNow = context.pages();
      childPage = pagesNow.find((page) => !beforePages.includes(page)) ?? null;
      if (!childPage) {
        throw new CliError("E_WAIT_TIMEOUT", "spawn did not produce a new target before timeout");
      }
    }

    await childPage
      .waitForLoadState("domcontentloaded", {
        timeout: Math.max(200, Math.min(1000, opts.timeoutMs)),
      })
      .catch(() => {
        // Not all spawned pages reach domcontentloaded in this window.
      });

    const childTargetId = await readPageTargetId(context, childPage);
    const title = await childPage.title();
    const actionCompletedAt = Date.now();

    const report: TargetSpawnReport = {
      ok: true,
      sessionId: session.sessionId,
      parentTargetId: requestedTargetId,
      childTargetId,
      actionId: newActionId(),
      query: parsed.query,
      url: childPage.url(),
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
    if (opts.persistState !== false) {
      await saveTargetSnapshot({
        targetId: report.childTargetId,
        sessionId: report.sessionId,
        url: report.url,
        title: report.title,
        status: null,
        lastActionId: report.actionId,
        lastActionAt: nowIso(),
        lastActionKind: "spawn",
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
