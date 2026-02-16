import { chromium } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { parseTargetQueryInput, resolveTargetQueryLocator } from "../infra/target-query.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../infra/targets.js";

type TargetFillReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  actionId: string;
  query: string;
  valueLength: number;
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

function parseFillValue(input: string | undefined): string {
  if (typeof input !== "string") throw new CliError("E_QUERY_INVALID", "value is required");
  return input;
}

export async function targetFill(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
  value?: string;
}): Promise<TargetFillReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseTargetQueryInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    containsQuery: opts.containsQuery,
    visibleOnly: opts.visibleOnly,
  });
  const value = parseFillValue(opts.value);

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
    const target = await resolveTargetHandle(browser, requestedTargetId);
    const { locator, count } = await resolveTargetQueryLocator({
      page: target.page,
      parsed,
      preferExactText: parsed.mode === "text",
    });

    // Match selection follows the click logic: first matching element (optionally visible-only).
    let selectedLocator = locator.first();
    let selectedVisible = false;
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
      selectedVisible = visible;
      break;
    }
    if (count < 1 || (parsed.visibleOnly && !selectedVisible)) {
      throw new CliError("E_QUERY_INVALID", parsed.visibleOnly ? "No visible element matched fill query" : "No element matched fill query");
    }

    await selectedLocator.fill(value, {
      timeout: opts.timeoutMs,
    });
    const title = await target.page.title();
    const actionCompletedAt = Date.now();

    const report: TargetFillReport = {
      ok: true,
      sessionId: session.sessionId,
      targetId: requestedTargetId,
      actionId: newActionId(),
      query: parsed.query,
      valueLength: value.length,
      url: target.page.url(),
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
        targetId: report.targetId,
        sessionId: report.sessionId,
        url: report.url,
        title: report.title,
        status: null,
        lastActionId: report.actionId,
        lastActionAt: nowIso(),
        lastActionKind: "fill",
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
