import { chromium, type Locator } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { parseTargetQueryInput, resolveTargetQueryLocator } from "../infra/target-query.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../infra/targets.js";
import { createCdpEvaluator, getCdpFrameTree, openCdpSession } from "../infra/cdp/index.js";
import { parseSettleMs, parseStepsCsv } from "./parse.js";
import type { TargetScrollPlanReport } from "./types.js";

const DEFAULT_SCROLL_PLAN_SETTLE_MS = 300;

async function countMatches(locator: Locator, visibleOnly: boolean): Promise<number> {
  const total = await locator.count();
  if (!visibleOnly || total === 0) {
    return total;
  }
  let visibleCount = 0;
  for (let idx = 0; idx < total; idx += 1) {
    if (await locator.nth(idx).isVisible()) {
      visibleCount += 1;
    }
  }
  return visibleCount;
}

export async function targetScrollPlan(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  stepsCsv?: string;
  settleMs?: number;
  countSelectorQuery?: string;
  countContainsQuery?: string;
  countVisibleOnly?: boolean;
}): Promise<TargetScrollPlanReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const requestedSteps = parseStepsCsv(opts.stepsCsv);
  const settleMs = parseSettleMs(opts.settleMs, DEFAULT_SCROLL_PLAN_SETTLE_MS);
  const countSelectorQuery = typeof opts.countSelectorQuery === "string" ? opts.countSelectorQuery.trim() : "";
  const countContainsQuery = typeof opts.countContainsQuery === "string" ? opts.countContainsQuery.trim() : "";
  const countVisibleOnly = Boolean(opts.countVisibleOnly);
  if (countContainsQuery.length > 0 && countSelectorQuery.length === 0) {
    throw new CliError("E_QUERY_INVALID", "count-contains requires count-selector");
  }
  if (countVisibleOnly && countSelectorQuery.length === 0) {
    throw new CliError("E_QUERY_INVALID", "count-visible-only requires count-selector");
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
    const cdp = await openCdpSession(target.page);
    const frameTree = await getCdpFrameTree(cdp);
    const worldCache = new Map<string, number>();
    const evaluator = createCdpEvaluator({ cdp, frameCdpId: frameTree.frame.id, worldCache });
    let countLocator: Locator | null = null;
    let countQuery: TargetScrollPlanReport["countQuery"] = null;
    if (countSelectorQuery.length > 0) {
      const parsedCountQuery = parseTargetQueryInput({
        selectorQuery: countSelectorQuery,
        containsQuery: countContainsQuery,
        visibleOnly: countVisibleOnly,
      });
      const resolvedCountQuery = await resolveTargetQueryLocator({
        page: target.page,
        parsed: parsedCountQuery,
      });
      countLocator = resolvedCountQuery.locator;
      countQuery = {
        selector: parsedCountQuery.selector ?? countSelectorQuery,
        contains: parsedCountQuery.contains,
        visibleOnly: parsedCountQuery.visibleOnly,
      };
    }

    const runtimeInfo = await evaluator.evaluate(() => {
      const runtime = globalThis as unknown as {
        document?: {
          scrollingElement?: {
            scrollHeight?: number;
          } | null;
        } | null;
        window?: {
          innerHeight?: number;
          innerWidth?: number;
          scrollY?: number;
          scrollTo?: (x: number, y: number) => void;
        } | null;
      };
      const scrollHeight = runtime.document?.scrollingElement?.scrollHeight ?? 0;
      const innerHeight = runtime.window?.innerHeight ?? 0;
      const maxScroll = Math.max(0, Math.round(scrollHeight - innerHeight));
      return {
        maxScroll,
        viewportWidth: runtime.window?.innerWidth ?? 0,
        viewportHeight: runtime.window?.innerHeight ?? 0,
      };
    });

    const steps: TargetScrollPlanReport["steps"] = [];
    for (let idx = 0; idx < requestedSteps.length; idx += 1) {
      const requestedY = requestedSteps[idx];
      const requestedUnit: TargetScrollPlanReport["steps"][number]["requestedUnit"] =
        requestedY > 0 && requestedY <= 1 ? "ratio" : "px";
      const requestedAbsolute = requestedUnit === "ratio" ? Math.round(runtimeInfo.maxScroll * requestedY) : requestedY;
      const appliedY = Math.max(0, Math.min(requestedAbsolute, runtimeInfo.maxScroll));
      await evaluator.evaluate(
        ({ y }: { y: number }) => {
          const runtime = globalThis as unknown as {
            window?: {
              scrollTo?: (x: number, y: number) => void;
            } | null;
          };
          runtime.window?.scrollTo?.(0, y);
        },
        { y: appliedY },
      );
      if (settleMs > 0) {
        await target.page.waitForTimeout(settleMs);
      }
      const achievedY = await evaluator.evaluate(() => {
        const runtime = globalThis as unknown as {
          window?: {
            scrollY?: number;
          } | null;
        };
        return Math.round(runtime.window?.scrollY ?? 0);
      });
      const count = countLocator ? await countMatches(countLocator, countQuery?.visibleOnly ?? false) : null;
      steps.push({
        index: idx,
        requestedUnit,
        requestedY,
        appliedY,
        achievedY,
        deltaY: achievedY - appliedY,
        count,
      });
    }

    const sampledCounts = steps.map((step) => step.count).filter((count): count is number => typeof count === "number");
    const countSummary: TargetScrollPlanReport["countSummary"] =
      sampledCounts.length > 0
        ? {
            sampleCount: sampledCounts.length,
            first: sampledCounts[0],
            last: sampledCounts[sampledCounts.length - 1],
            delta: sampledCounts[sampledCounts.length - 1] - sampledCounts[0],
            min: Math.min(...sampledCounts),
            max: Math.max(...sampledCounts),
          }
        : null;

    const actionCompletedAt = Date.now();
    const report: TargetScrollPlanReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      actionId: newActionId(),
      settleMs,
      maxScroll: runtimeInfo.maxScroll,
      viewport: {
        width: runtimeInfo.viewportWidth,
        height: runtimeInfo.viewportHeight,
      },
      countQuery,
      countSummary,
      steps,
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
        lastActionKind: "scroll-plan",
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
