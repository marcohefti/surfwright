import { chromium } from "playwright-core";
import { newActionId } from "../../../action-id.js";
import { CliError } from "../../../errors.js";
import { nowIso, saveTargetSnapshot } from "../../../state/index.js";
import { ensureValidSelector, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";

type TargetDragDropReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  actionId: string;
  from: string;
  to: string;
  result: "dragged";
  timingMs: {
    total: number;
    resolveSession: number;
    connectCdp: number;
    action: number;
    persistState: number;
  };
};

function parseRequiredSelector(input: string | undefined, optionName: string): string {
  const selector = typeof input === "string" ? input.trim() : "";
  if (selector.length === 0) {
    throw new CliError("E_QUERY_INVALID", `${optionName} selector is required`);
  }
  return selector;
}

export async function targetDragDrop(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  fromSelector?: string;
  toSelector?: string;
}): Promise<TargetDragDropReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const fromSelector = parseRequiredSelector(opts.fromSelector, "from");
  const toSelector = parseRequiredSelector(opts.toSelector, "to");

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
    await ensureValidSelector(target.page, fromSelector);
    await ensureValidSelector(target.page, toSelector);

    const fromCount = await target.page.locator(fromSelector).count();
    if (fromCount < 1) {
      throw new CliError("E_QUERY_INVALID", `No element matched source selector: ${fromSelector}`);
    }
    const toCount = await target.page.locator(toSelector).count();
    if (toCount < 1) {
      throw new CliError("E_QUERY_INVALID", `No element matched destination selector: ${toSelector}`);
    }

    await target.page.dragAndDrop(fromSelector, toSelector, {
      timeout: opts.timeoutMs,
    });
    const actionCompletedAt = Date.now();

    const report: TargetDragDropReport = {
      ok: true,
      sessionId: session.sessionId,
      targetId: requestedTargetId,
      actionId: newActionId(),
      from: fromSelector,
      to: toSelector,
      result: "dragged",
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
        url: target.page.url(),
        title: await target.page.title(),
        status: null,
        lastActionId: report.actionId,
        lastActionAt: nowIso(),
        lastActionKind: "drag-drop",
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

