import { chromium } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { extractTargetQueryPreview, parseTargetQueryInput, resolveTargetQueryLocator } from "../target-query.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";
import { parseDurationMs, parseIntervalMs, parseMaxSamples, parsePropertiesCsv, parseSettleMs } from "./parse.js";
import { resolveFirstMatch } from "./query-match.js";
import { targetObserve } from "./target-observe.js";
import { targetScrollWatch } from "./target-scroll-watch.js";
import type { TargetHoverReport, TargetMotionDetectReport, TargetStickyCheckReport } from "./types.js";

const DEFAULT_HOVER_PROPERTIES = ["color", "background-color", "box-shadow", "transform", "opacity"];
const DEFAULT_HOVER_SETTLE_MS = 180;
const DEFAULT_STICKY_SELECTOR = "header";
const DEFAULT_STICKY_STEPS = "0,220,640,0";
const DEFAULT_STICKY_SETTLE_MS = 300;
const DEFAULT_MOTION_PROPERTY = "transform";
const DEFAULT_MOTION_INTERVAL_MS = 350;
const DEFAULT_MOTION_DURATION_MS = 2800;
const DEFAULT_MOTION_MAX_SAMPLES = 120;

async function persistTargetAction(opts: {
  targetId: string;
  sessionId: string;
  actionId: string;
  actionKind: string;
  timeoutMs: number;
}): Promise<void> {
  const { session } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: opts.targetId,
  });
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  try {
    const target = await resolveTargetHandle(browser, opts.targetId);
    await saveTargetSnapshot({
      targetId: opts.targetId,
      sessionId: opts.sessionId,
      url: target.page.url(),
      title: await target.page.title(),
      status: null,
      lastActionId: opts.actionId,
      lastActionAt: nowIso(),
      lastActionKind: opts.actionKind,
      updatedAt: nowIso(),
    });
  } finally {
    await browser.close();
  }
}

export async function targetHover(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
  propertiesCsv?: string;
  settleMs?: number;
}): Promise<TargetHoverReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseTargetQueryInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    containsQuery: opts.containsQuery,
    visibleOnly: opts.visibleOnly,
  });
  const properties = parsePropertiesCsv(opts.propertiesCsv, DEFAULT_HOVER_PROPERTIES);
  const settleMs = parseSettleMs(opts.settleMs, DEFAULT_HOVER_SETTLE_MS);

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
    const selected = await resolveFirstMatch({
      locator,
      count,
      visibleOnly: parsed.visibleOnly,
    });
    const preview = await extractTargetQueryPreview(selected.locator);
    const measure = async (): Promise<Record<string, string | null>> =>
      await selected.locator.evaluate(
        (node: any, input: { properties: string[] }) => {
          const runtime = globalThis as unknown as {
            getComputedStyle?: (el: unknown) => { getPropertyValue?: (name: string) => string } | null;
          };
          const out: Record<string, string | null> = {};
          for (const property of input.properties) {
            const value = runtime.getComputedStyle?.(node)?.getPropertyValue?.(property) ?? "";
            const normalized = typeof value === "string" ? value.trim() : "";
            out[property] = normalized.length > 0 ? normalized : null;
          }
          return out;
        },
        { properties },
      );

    const before = await measure();
    await selected.locator.hover({
      timeout: opts.timeoutMs,
    });
    if (settleMs > 0) {
      await target.page.waitForTimeout(settleMs);
    }
    const after = await measure();

    const diffs: TargetHoverReport["diffs"] = [];
    for (const property of properties) {
      const prev = before[property] ?? null;
      const next = after[property] ?? null;
      if (prev !== next) {
        diffs.push({
          property,
          before: prev,
          after: next,
        });
      }
    }
    const actionCompletedAt = Date.now();

    const report: TargetHoverReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      actionId: newActionId(),
      query: {
        mode: parsed.mode,
        query: parsed.query,
        selector: parsed.selector,
        contains: parsed.contains,
        visibleOnly: parsed.visibleOnly,
      },
      hovered: {
        index: selected.index,
        text: preview.text,
        visible: selected.visible,
        selectorHint: preview.selectorHint,
      },
      properties,
      settleMs,
      before,
      after,
      diffs,
      changedCount: diffs.length,
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
        lastActionKind: "hover",
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

export async function targetStickyCheck(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
  stepsCsv?: string;
  settleMs?: number;
}): Promise<TargetStickyCheckReport> {
  const startedAt = Date.now();
  const selector = typeof opts.selectorQuery === "string" && opts.selectorQuery.trim().length > 0 ? opts.selectorQuery : DEFAULT_STICKY_SELECTOR;
  const stepsCsv = typeof opts.stepsCsv === "string" && opts.stepsCsv.trim().length > 0 ? opts.stepsCsv : DEFAULT_STICKY_STEPS;
  const settleMs = parseSettleMs(opts.settleMs, DEFAULT_STICKY_SETTLE_MS);
  const watch = await targetScrollWatch({
    targetId: opts.targetId,
    timeoutMs: opts.timeoutMs,
    sessionId: opts.sessionId,
    persistState: false,
    selectorQuery: selector,
    containsQuery: opts.containsQuery,
    visibleOnly: opts.visibleOnly,
    propertiesCsv: "position,top",
    stepsCsv,
    settleMs,
    maxEvents: 120,
  });
  const actionCompletedAt = Date.now();

  const positions = watch.samples.map((sample) => sample.computed.position ?? null);
  const topValues = watch.samples.map((sample) => sample.rectTop).filter((value): value is number => typeof value === "number");
  const maxTop = topValues.length > 0 ? Math.max(...topValues) : null;
  const minTop = topValues.length > 0 ? Math.min(...topValues) : null;
  const topDriftPx = maxTop !== null && minTop !== null ? Math.round((maxTop - minTop) * 100) / 100 : null;
  const achieved = watch.samples.map((sample) => sample.achievedY);
  const scrollRangePx = achieved.length > 0 ? Math.max(...achieved) - Math.min(...achieved) : 0;
  const hasStickyPosition = positions.some((entry) => entry === "sticky" || entry === "fixed");
  const sticky = hasStickyPosition && scrollRangePx >= 100 && (topDriftPx === null || topDriftPx <= 5);

  const report: TargetStickyCheckReport = {
    ok: true,
    sessionId: watch.sessionId,
    sessionSource: watch.sessionSource,
    targetId: watch.targetId,
    actionId: newActionId(),
    selector: watch.query.selector,
    contains: watch.query.contains,
    visibleOnly: watch.query.visibleOnly,
    stepsCsv,
    settleMs,
    sticky,
    evidence: {
      positions,
      topDriftPx,
      scrollRangePx,
      changeCount: watch.changeCount,
      transitionEvents: watch.transition.eventCount,
    },
    samples: watch.samples.map((sample) => ({
      index: sample.index,
      achievedY: sample.achievedY,
      rectTop: sample.rectTop,
      position: sample.computed.position ?? null,
      top: sample.computed.top ?? null,
    })),
    timingMs: {
      total: 0,
      resolveSession: watch.timingMs.resolveSession,
      connectCdp: watch.timingMs.connectCdp,
      action: actionCompletedAt - startedAt,
      persistState: 0,
    },
  };

  const persistStartedAt = Date.now();
  if (opts.persistState !== false) {
    await persistTargetAction({
      targetId: report.targetId,
      sessionId: report.sessionId,
      actionId: report.actionId,
      actionKind: "sticky-check",
      timeoutMs: opts.timeoutMs,
    });
  }
  const persistedAt = Date.now();
  report.timingMs.persistState = persistedAt - persistStartedAt;
  report.timingMs.total = persistedAt - startedAt;
  return report;
}

export async function targetMotionDetect(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
  property?: string;
  intervalMs?: number;
  durationMs?: number;
  maxSamples?: number;
}): Promise<TargetMotionDetectReport> {
  const startedAt = Date.now();
  const selector = typeof opts.selectorQuery === "string" ? opts.selectorQuery : "";
  const property = typeof opts.property === "string" && opts.property.trim().length > 0 ? opts.property : DEFAULT_MOTION_PROPERTY;
  const intervalMs = parseIntervalMs(opts.intervalMs, DEFAULT_MOTION_INTERVAL_MS);
  const durationMs = parseDurationMs(opts.durationMs, DEFAULT_MOTION_DURATION_MS);
  const maxSamples = parseMaxSamples(opts.maxSamples, DEFAULT_MOTION_MAX_SAMPLES);

  const observed = await targetObserve({
    targetId: opts.targetId,
    timeoutMs: opts.timeoutMs,
    sessionId: opts.sessionId,
    persistState: false,
    selectorQuery: selector,
    containsQuery: opts.containsQuery,
    visibleOnly: opts.visibleOnly,
    property,
    intervalMs,
    durationMs,
    maxSamples,
  });
  const actionCompletedAt = Date.now();
  const uniqueValues = new Set(observed.samples.map((sample) => sample.value ?? "__null__")).size;
  const motionDetected = observed.changes > 0 && uniqueValues > 1;

  const report: TargetMotionDetectReport = {
    ok: true,
    sessionId: observed.sessionId,
    sessionSource: observed.sessionSource,
    targetId: observed.targetId,
    actionId: newActionId(),
    query: observed.query,
    observed: observed.observed,
    property: observed.property,
    intervalMs: observed.intervalMs,
    durationMs: observed.durationMs,
    maxSamples: observed.maxSamples,
    sampleCount: observed.sampleCount,
    changes: observed.changes,
    uniqueValues,
    firstValue: observed.firstValue,
    lastValue: observed.lastValue,
    motionDetected,
    samples: observed.samples,
    timingMs: {
      total: 0,
      resolveSession: observed.timingMs.resolveSession,
      connectCdp: observed.timingMs.connectCdp,
      action: actionCompletedAt - startedAt,
      persistState: 0,
    },
  };

  const persistStartedAt = Date.now();
  if (opts.persistState !== false) {
    await persistTargetAction({
      targetId: report.targetId,
      sessionId: report.sessionId,
      actionId: report.actionId,
      actionKind: "motion-detect",
      timeoutMs: opts.timeoutMs,
    });
  }
  const persistedAt = Date.now();
  report.timingMs.persistState = persistedAt - persistStartedAt;
  report.timingMs.total = persistedAt - startedAt;
  return report;
}
