import { chromium } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { extractTargetQueryPreview, parseTargetQueryInput, resolveTargetQueryLocator } from "../infra/target-query.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../infra/targets.js";
import { createCdpEvaluator, getCdpFrameTree, openCdpSession } from "../infra/cdp/index.js";
import { parsePropertyName, parseSettleMs, parseStepsCsv } from "./parse.js";
import { resolveFirstMatch } from "./query-match.js";
import type { TargetScrollSampleReport } from "./types.js";

const DEFAULT_SCROLL_SAMPLE_SETTLE_MS = 300;
const DEFAULT_SCROLL_SAMPLE_PROPERTY = "transform";
const SCROLL_SAMPLE_MAX_VALUE_CHARS = 300;

export async function targetScrollSample(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
  property?: string;
  stepsCsv?: string;
  settleMs?: number;
}): Promise<TargetScrollSampleReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const selectorQuery = typeof opts.selectorQuery === "string" ? opts.selectorQuery.trim() : "";
  if (selectorQuery.length === 0) {
    throw new CliError("E_QUERY_INVALID", "selector is required");
  }
  const parsed = parseTargetQueryInput({
    selectorQuery,
    containsQuery: opts.containsQuery,
    visibleOnly: opts.visibleOnly,
  });
  const property = parsePropertyName(opts.property, DEFAULT_SCROLL_SAMPLE_PROPERTY);
  const requestedSteps = parseStepsCsv(opts.stepsCsv);
  const settleMs = parseSettleMs(opts.settleMs, DEFAULT_SCROLL_SAMPLE_SETTLE_MS);

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
    });
    const selected = await resolveFirstMatch({
      locator,
      count,
      visibleOnly: parsed.visibleOnly,
    });
    const preview = await extractTargetQueryPreview(selected.locator);

    const cdp = await openCdpSession(target.page);
    const frameTree = await getCdpFrameTree(cdp);
    const worldCache = new Map<string, number>();
    const evaluator = createCdpEvaluator({ cdp, frameCdpId: frameTree.frame.id, worldCache });

    const runtimeInfo = await evaluator.evaluate(() => {
      const runtime = globalThis as unknown as {
        document?: { scrollingElement?: { scrollHeight?: number } | null } | null;
        window?: { innerHeight?: number; innerWidth?: number } | null;
      };
      const scrollHeight = runtime.document?.scrollingElement?.scrollHeight ?? 0;
      const innerHeight = runtime.window?.innerHeight ?? 0;
      return {
        maxScroll: Math.max(0, Math.round(scrollHeight - innerHeight)),
        viewportWidth: runtime.window?.innerWidth ?? 0,
        viewportHeight: runtime.window?.innerHeight ?? 0,
      };
    });

    const steps: TargetScrollSampleReport["steps"] = [];
    for (let idx = 0; idx < requestedSteps.length; idx += 1) {
      const requestedY = requestedSteps[idx];
      const appliedY = Math.max(0, Math.min(requestedY, runtimeInfo.maxScroll));
      await evaluator.evaluate(
        ({ y }: { y: number }) => {
          const runtime = globalThis as unknown as {
            window?: { scrollTo?: (x: number, y: number) => void } | null;
          };
          runtime.window?.scrollTo?.(0, y);
        },
        { y: appliedY },
      );
      if (settleMs > 0) {
        await target.page.waitForTimeout(settleMs);
      }

      const observed = await selected.locator.evaluate(
        (node: any, { property, maxChars }: { property: string; maxChars: number }) => {
          const runtime = globalThis as unknown as {
            getComputedStyle?: (el: unknown) => { getPropertyValue?: (name: string) => string } | null;
            window?: { scrollY?: number } | null;
          };
          const clipped = (value: string): string => value.slice(0, maxChars);
          const styleValue = runtime.getComputedStyle?.(node)?.getPropertyValue?.(property) ?? "";
          const normalized = typeof styleValue === "string" ? styleValue.trim() : "";
          const value =
            normalized.length > 0
              ? clipped(normalized)
              : (() => {
                  const direct = node?.[property];
                  if (typeof direct === "undefined" || direct === null) {
                    return null;
                  }
                  return clipped(typeof direct === "string" ? direct : String(direct));
                })();
          return {
            value,
            scrollY: Math.round(runtime.window?.scrollY ?? 0),
          };
        },
        { property, maxChars: SCROLL_SAMPLE_MAX_VALUE_CHARS },
      );

      steps.push({
        index: idx,
        requestedY,
        appliedY,
        achievedY: observed.scrollY,
        deltaY: observed.scrollY - requestedY,
        value: observed.value,
      });
    }

    let valueChanges = 0;
    for (let idx = 1; idx < steps.length; idx += 1) {
      if (steps[idx - 1].value !== steps[idx].value) {
        valueChanges += 1;
      }
    }

    const actionCompletedAt = Date.now();
    const report: TargetScrollSampleReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      actionId: newActionId(),
      query: {
        selector: parsed.selector ?? selectorQuery,
        contains: parsed.contains,
        visibleOnly: parsed.visibleOnly,
      },
      observed: {
        index: selected.index,
        text: preview.text,
        visible: selected.visible,
        selectorHint: preview.selectorHint,
      },
      property,
      settleMs,
      maxScroll: runtimeInfo.maxScroll,
      viewport: {
        width: runtimeInfo.viewportWidth,
        height: runtimeInfo.viewportHeight,
      },
      steps,
      valueChanges,
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
        lastActionKind: "scroll-sample",
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
