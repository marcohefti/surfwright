import { chromium } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../infra/targets.js";
import { createCdpEvaluator, getCdpFrameTree, openCdpSession } from "../infra/cdp/index.js";
import type { BrowserRuntimeLike, BrowserNodeLike } from "../infra/types/browser-dom-types.js";
import { parseSettleMs, parseStepsCsv } from "./parse.js";
import { targetScrollWatch } from "./target-scroll-watch.js";
import { targetTransitionTrace } from "./target-transition-trace.js";
import type { TargetScrollRevealScanReport, TargetTransitionAssertReport } from "./types.js";

const DEFAULT_TRANSITION_ASSERT_CYCLES = 2;
const MAX_TRANSITION_ASSERT_CYCLES = 5;
const DEFAULT_REVEAL_STEPS = "0,260,620";
const DEFAULT_REVEAL_SETTLE_MS = 260;
const DEFAULT_REVEAL_MAX_CANDIDATES = 6;
const MAX_REVEAL_MAX_CANDIDATES = 20;
const REVEAL_SELECTOR_HINT =
  "[data-aos], [class*='fade'], [class*='reveal'], [class*='anim'], section, article, .card, .feature";

function parseCycles(input: number | undefined): number {
  if (typeof input === "undefined") {
    return DEFAULT_TRANSITION_ASSERT_CYCLES;
  }
  if (!Number.isFinite(input) || !Number.isInteger(input) || input < 1 || input > MAX_TRANSITION_ASSERT_CYCLES) {
    throw new CliError("E_QUERY_INVALID", `cycles must be an integer between 1 and ${MAX_TRANSITION_ASSERT_CYCLES}`);
  }
  return input;
}

function parseMaxCandidates(input: number | undefined): number {
  if (typeof input === "undefined") {
    return DEFAULT_REVEAL_MAX_CANDIDATES;
  }
  if (!Number.isFinite(input) || !Number.isInteger(input) || input < 1 || input > MAX_REVEAL_MAX_CANDIDATES) {
    throw new CliError("E_QUERY_INVALID", `max-candidates must be an integer between 1 and ${MAX_REVEAL_MAX_CANDIDATES}`);
  }
  return input;
}

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

export async function targetTransitionAssert(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  captureMs?: number;
  maxEvents?: number;
  cycles?: number;
  clickText?: string;
  clickSelector?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
}): Promise<TargetTransitionAssertReport> {
  const startedAt = Date.now();
  const cycles = parseCycles(opts.cycles);
  const runs: TargetTransitionAssertReport["runs"] = [];
  let referenceSessionId: string | null = null;
  let referenceSessionSource: TargetTransitionAssertReport["sessionSource"] | null = null;
  let referenceResolveSessionMs = 0;
  let referenceConnectCdpMs = 0;

  for (let idx = 0; idx < cycles; idx += 1) {
    const trace = await targetTransitionTrace({
      targetId: opts.targetId,
      timeoutMs: opts.timeoutMs,
      sessionId: opts.sessionId,
      persistState: false,
      captureMs: opts.captureMs,
      maxEvents: opts.maxEvents,
      clickText: opts.clickText,
      clickSelector: opts.clickSelector,
      containsQuery: opts.containsQuery,
      visibleOnly: opts.visibleOnly,
    });
    if (!referenceSessionId) {
      referenceSessionId = trace.sessionId;
      referenceSessionSource = trace.sessionSource;
      referenceResolveSessionMs = trace.timingMs.resolveSession;
      referenceConnectCdpMs = trace.timingMs.connectCdp;
    }
    runs.push({
      cycle: idx + 1,
      eventCount: trace.eventCount,
      emitted: trace.emitted,
      dropped: trace.dropped,
      truncated: trace.truncated,
      countsByKind: trace.countsByKind,
      trigger: trace.trigger,
    });
  }

  const actionCompletedAt = Date.now();
  const asserted = runs.length > 0 && runs.every((entry) => entry.eventCount > 0);
  const totalEvents = runs.reduce((sum, entry) => sum + entry.eventCount, 0);
  const totalDropped = runs.reduce((sum, entry) => sum + entry.dropped, 0);
  const countsByKind: Record<string, number> = {};
  for (const run of runs) {
    for (const [kind, count] of Object.entries(run.countsByKind)) {
      countsByKind[kind] = (countsByKind[kind] ?? 0) + count;
    }
  }

  if (!referenceSessionId || !referenceSessionSource) {
    throw new CliError("E_INTERNAL", "transition assert failed to capture session metadata");
  }

  const report: TargetTransitionAssertReport = {
    ok: true,
    sessionId: referenceSessionId,
    sessionSource: referenceSessionSource,
    targetId: sanitizeTargetId(opts.targetId),
    actionId: newActionId(),
    cycles,
    asserted,
    totalEvents,
    totalDropped,
    countsByKind,
    runs,
    timingMs: {
      total: 0,
      resolveSession: referenceResolveSessionMs,
      connectCdp: referenceConnectCdpMs,
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
      actionKind: "transition-assert",
      timeoutMs: opts.timeoutMs,
    });
  }
  const persistedAt = Date.now();
  report.timingMs.persistState = persistedAt - persistStartedAt;
  report.timingMs.total = persistedAt - startedAt;
  return report;
}

async function discoverRevealSelectors(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  maxCandidates: number;
}): Promise<{ sessionId: string; selectors: string[] }> {
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const { session } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: requestedTargetId,
  });
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    const cdp = await openCdpSession(target.page);
    const frameTree = await getCdpFrameTree(cdp);
    const worldCache = new Map<string, number>();
    const evaluator = createCdpEvaluator({ cdp, frameCdpId: frameTree.frame.id, worldCache });

    const selectors = await evaluator.evaluate(
      ({ maxCandidates, selectorQuery }: { maxCandidates: number; selectorQuery: string }) => {
        const runtime = globalThis as unknown as BrowserRuntimeLike & {
          document?: {
            querySelectorAll?: (query: string) => ArrayLike<BrowserNodeLike>;
          } | null;
        };
        const nodes = Array.from(runtime.document?.querySelectorAll?.(selectorQuery) ?? []);
        const out: string[] = [];
        const seen = new Set<string>();
        for (const node of nodes) {
          if (out.length >= maxCandidates) {
            break;
          }
          if (!node || typeof node !== "object") {
            continue;
          }
          const id = typeof node.id === "string" ? node.id.trim() : "";
          if (id.length > 0) {
            const selector = `#${id}`;
            if (!seen.has(selector)) {
              seen.add(selector);
              out.push(selector);
            }
            continue;
          }

          const tag = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "";
          const classNameRaw = typeof node.className === "string" ? node.className.trim() : "";
          const classToken =
            classNameRaw.length > 0
              ? classNameRaw
                  .split(/\s+/)
                  .map((entry: string) => entry.trim())
                  .find((entry: string) => entry.length > 0)
              : null;
          if (tag.length === 0 && !classToken) {
            continue;
          }
          const selector = classToken ? `${tag || "div"}.${classToken}` : tag;
          if (!seen.has(selector)) {
            seen.add(selector);
            out.push(selector);
          }
        }
        return out;
      },
      { maxCandidates: opts.maxCandidates, selectorQuery: REVEAL_SELECTOR_HINT },
    );
    return {
      sessionId: session.sessionId,
      selectors,
    };
  } finally {
    await browser.close();
  }
}

export async function targetScrollRevealScan(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
  stepsCsv?: string;
  settleMs?: number;
  maxCandidates?: number;
}): Promise<TargetScrollRevealScanReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const stepsCsv = typeof opts.stepsCsv === "string" && opts.stepsCsv.trim().length > 0 ? opts.stepsCsv : DEFAULT_REVEAL_STEPS;
  const settleMs = parseSettleMs(opts.settleMs, DEFAULT_REVEAL_SETTLE_MS);
  const maxCandidates = parseMaxCandidates(opts.maxCandidates);
  const parsedSteps = parseStepsCsv(stepsCsv);
  if (parsedSteps.length < 2) {
    throw new CliError("E_QUERY_INVALID", "steps must include at least two positions for reveal scanning");
  }

  let selectors: string[] = [];
  let resolvedSessionId: string | null = null;
  if (typeof opts.selectorQuery === "string" && opts.selectorQuery.trim().length > 0) {
    selectors = [opts.selectorQuery.trim()];
  } else {
    const discovered = await discoverRevealSelectors({
      targetId: requestedTargetId,
      timeoutMs: opts.timeoutMs,
      sessionId: opts.sessionId,
      maxCandidates,
    });
    resolvedSessionId = discovered.sessionId;
    selectors = discovered.selectors;
  }
  if (selectors.length === 0) {
    throw new CliError("E_QUERY_INVALID", "No reveal-scan candidates found");
  }

  const candidates: TargetScrollRevealScanReport["candidates"] = [];
  let sessionSource: TargetScrollRevealScanReport["sessionSource"] = "explicit";
  let sessionId = resolvedSessionId;
  for (const selector of selectors.slice(0, maxCandidates)) {
    try {
      const watch = await targetScrollWatch({
        targetId: requestedTargetId,
        timeoutMs: opts.timeoutMs,
        sessionId: opts.sessionId,
        persistState: false,
        selectorQuery: selector,
        containsQuery: opts.containsQuery,
        visibleOnly: opts.visibleOnly,
        propertiesCsv: "opacity,transform,visibility",
        stepsCsv,
        settleMs,
        maxEvents: 120,
      });
      sessionSource = watch.sessionSource;
      sessionId = watch.sessionId;
      const first = watch.samples[0];
      const last = watch.samples[watch.samples.length - 1];
      const opacityFrom = first?.computed.opacity ?? null;
      const opacityTo = last?.computed.opacity ?? null;
      const transformFrom = first?.computed.transform ?? null;
      const transformTo = last?.computed.transform ?? null;
      const visibilityFrom = first?.computed.visibility ?? null;
      const visibilityTo = last?.computed.visibility ?? null;
      const revealDetected =
        watch.changeCount > 0 &&
        ((opacityFrom !== opacityTo && opacityFrom !== null && opacityTo !== null) ||
          (transformFrom !== transformTo && transformFrom !== null && transformTo !== null) ||
          (visibilityFrom !== visibilityTo && visibilityFrom !== null && visibilityTo !== null));

      candidates.push({
        selector,
        revealDetected,
        changeCount: watch.changeCount,
        transitionEvents: watch.transition.eventCount,
        first: {
          opacity: opacityFrom,
          transform: transformFrom,
          visibility: visibilityFrom,
          scrollY: first?.achievedY ?? 0,
        },
        last: {
          opacity: opacityTo,
          transform: transformTo,
          visibility: visibilityTo,
          scrollY: last?.achievedY ?? 0,
        },
        error: null,
      });
    } catch (error) {
      candidates.push({
        selector,
        revealDetected: false,
        changeCount: 0,
        transitionEvents: 0,
        first: null,
        last: null,
        error: error instanceof Error ? error.message : "scan failed",
      });
    }
  }
  const actionCompletedAt = Date.now();
  const revealedCount = candidates.filter((entry) => entry.revealDetected).length;

  const report: TargetScrollRevealScanReport = {
    ok: true,
    sessionId: sessionId ?? "",
    sessionSource,
    targetId: requestedTargetId,
    actionId: newActionId(),
    selectorQuery: typeof opts.selectorQuery === "string" ? opts.selectorQuery.trim() || null : null,
    containsQuery: typeof opts.containsQuery === "string" ? opts.containsQuery.trim() || null : null,
    visibleOnly: Boolean(opts.visibleOnly),
    stepsCsv,
    settleMs,
    maxCandidates,
    scannedCount: candidates.length,
    revealedCount,
    candidates,
    timingMs: {
      total: 0,
      resolveSession: 0,
      connectCdp: 0,
      action: actionCompletedAt - startedAt,
      persistState: 0,
    },
  };

  if (!report.sessionId) {
    const reference = await targetTransitionTrace({
      targetId: requestedTargetId,
      timeoutMs: opts.timeoutMs,
      sessionId: opts.sessionId,
      persistState: false,
      captureMs: 1,
      maxEvents: 1,
    });
    report.sessionId = reference.sessionId;
    report.sessionSource = reference.sessionSource;
    report.timingMs.resolveSession = reference.timingMs.resolveSession;
    report.timingMs.connectCdp = reference.timingMs.connectCdp;
  }

  const persistStartedAt = Date.now();
  if (opts.persistState !== false) {
    await persistTargetAction({
      targetId: report.targetId,
      sessionId: report.sessionId,
      actionId: report.actionId,
      actionKind: "scroll-reveal-scan",
      timeoutMs: opts.timeoutMs,
    });
  }
  const persistedAt = Date.now();
  report.timingMs.persistState = persistedAt - persistStartedAt;
  report.timingMs.total = persistedAt - startedAt;
  return report;
}
