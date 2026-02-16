import { chromium } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { extractTargetQueryPreview, parseTargetQueryInput, resolveTargetQueryLocator } from "../target-query.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";
import { resolveFirstMatch } from "./query-match.js";
import type { TargetTransitionTraceReport } from "./types.js";

const DEFAULT_TRANSITION_TRACE_CAPTURE_MS = 2500;
const MAX_TRANSITION_TRACE_CAPTURE_MS = 60_000;
const DEFAULT_TRANSITION_TRACE_MAX_EVENTS = 120;
const MAX_TRANSITION_TRACE_MAX_EVENTS = 1000;

function parseCaptureMs(input: number | undefined): number {
  if (typeof input === "undefined") {
    return DEFAULT_TRANSITION_TRACE_CAPTURE_MS;
  }
  if (!Number.isFinite(input) || !Number.isInteger(input) || input < 1 || input > MAX_TRANSITION_TRACE_CAPTURE_MS) {
    throw new CliError("E_QUERY_INVALID", `capture-ms must be an integer between 1 and ${MAX_TRANSITION_TRACE_CAPTURE_MS}`);
  }
  return input;
}

function parseMaxEvents(input: number | undefined): number {
  if (typeof input === "undefined") {
    return DEFAULT_TRANSITION_TRACE_MAX_EVENTS;
  }
  if (!Number.isFinite(input) || !Number.isInteger(input) || input < 1 || input > MAX_TRANSITION_TRACE_MAX_EVENTS) {
    throw new CliError("E_QUERY_INVALID", `max-events must be an integer between 1 and ${MAX_TRANSITION_TRACE_MAX_EVENTS}`);
  }
  return input;
}

function parseTraceClickQuery(opts: {
  clickText?: string;
  clickSelector?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
}):
  | {
      mode: "text" | "selector";
      query: string;
      selector: string | null;
      contains: string | null;
      visibleOnly: boolean;
    }
  | null {
  const clickText = typeof opts.clickText === "string" ? opts.clickText.trim() : "";
  const clickSelector = typeof opts.clickSelector === "string" ? opts.clickSelector.trim() : "";
  const contains = typeof opts.containsQuery === "string" ? opts.containsQuery.trim() : "";
  const hasAny = clickText.length > 0 || clickSelector.length > 0 || contains.length > 0;
  if (!hasAny) {
    return null;
  }
  return parseTargetQueryInput({
    textQuery: clickText,
    selectorQuery: clickSelector,
    containsQuery: contains,
    visibleOnly: opts.visibleOnly,
  });
}

export async function targetTransitionTrace(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  captureMs?: number;
  maxEvents?: number;
  clickText?: string;
  clickSelector?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
}): Promise<TargetTransitionTraceReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const captureMs = parseCaptureMs(opts.captureMs);
  const maxEvents = parseMaxEvents(opts.maxEvents);
  const clickQuery = parseTraceClickQuery({
    clickText: opts.clickText,
    clickSelector: opts.clickSelector,
    containsQuery: opts.containsQuery,
    visibleOnly: opts.visibleOnly,
  });

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

    await target.page.evaluate(
      ({ maxEvents }: { maxEvents: number }) => {
        const runtime = globalThis as unknown as {
          __surfwrightTransitionTrace?: {
            installed: boolean;
            maxEvents: number;
            dropped: number;
            events: Array<{
              kind: string;
              propertyName: string | null;
              animationName: string | null;
              elapsedMs: number | null;
              selector: string | null;
              text: string | null;
              scrollY: number;
              timeMs: number;
            }>;
          };
          document?: {
            addEventListener?: (name: string, listener: (event: unknown) => void, options?: boolean) => void;
          } | null;
          performance?: {
            now?: () => number;
          } | null;
          window?: {
            scrollY?: number;
          } | null;
        };
        const toSelector = (el: EventTarget | null): string | null => {
          if (!el || typeof el !== "object") {
            return null;
          }
          const elementLike = el as {
            nodeType?: number;
            tagName?: string;
            id?: string;
            className?: string;
          };
          if (elementLike.nodeType !== 1 || typeof elementLike.tagName !== "string") {
            return null;
          }
          const tag = elementLike.tagName.toLowerCase();
          const id = typeof elementLike.id === "string" && elementLike.id.length > 0 ? `#${elementLike.id}` : "";
          const className = typeof elementLike.className === "string" ? elementLike.className.trim() : "";
          const classSuffix =
            className.length > 0
              ? `.${className
                  .split(/\s+/)
                  .filter((entry: string) => entry.length > 0)
                  .slice(0, 2)
                  .join(".")}`
              : "";
          return `${tag}${id}${classSuffix}`;
        };
        const toText = (el: EventTarget | null): string | null => {
          if (!el || typeof el !== "object") {
            return null;
          }
          const elementLike = el as {
            textContent?: string | null;
          };
          const raw = (elementLike.textContent ?? "").replace(/\s+/g, " ").trim();
          return raw.length > 0 ? raw.slice(0, 80) : null;
        };

        if (!runtime.__surfwrightTransitionTrace) {
          const state = {
            installed: false,
            maxEvents,
            dropped: 0,
            events: [] as Array<{
              kind: string;
              propertyName: string | null;
              animationName: string | null;
              elapsedMs: number | null;
              selector: string | null;
              text: string | null;
              scrollY: number;
              timeMs: number;
            }>,
          };
          runtime.__surfwrightTransitionTrace = state;
        }

        const state = runtime.__surfwrightTransitionTrace;
        state.maxEvents = maxEvents;
        state.events = [];
        state.dropped = 0;

        if (!state.installed) {
          const pushEvent = (kind: string, event: unknown) => {
            if (state.events.length >= state.maxEvents) {
              state.dropped += 1;
              return;
            }
            const eventLike = event as any;
            state.events.push({
              kind,
              propertyName: typeof eventLike.propertyName === "string" && eventLike.propertyName.length > 0 ? eventLike.propertyName : null,
              animationName: typeof eventLike.animationName === "string" && eventLike.animationName.length > 0 ? eventLike.animationName : null,
              elapsedMs: typeof eventLike.elapsedTime === "number" ? Math.round(eventLike.elapsedTime * 1000) : null,
              selector: toSelector(eventLike.target ?? null),
              text: toText(eventLike.target ?? null),
              scrollY: Math.round(runtime.window?.scrollY ?? 0),
              timeMs: Math.round(runtime.performance?.now?.() ?? 0),
            });
          };

          runtime.document?.addEventListener?.("transitionrun", (event: unknown) => pushEvent("transitionrun", event), true);
          runtime.document?.addEventListener?.("transitionstart", (event: unknown) => pushEvent("transitionstart", event), true);
          runtime.document?.addEventListener?.("transitionend", (event: unknown) => pushEvent("transitionend", event), true);
          runtime.document?.addEventListener?.("animationstart", (event: unknown) => pushEvent("animationstart", event), true);
          runtime.document?.addEventListener?.("animationiteration", (event: unknown) => pushEvent("animationiteration", event), true);
          runtime.document?.addEventListener?.("animationend", (event: unknown) => pushEvent("animationend", event), true);
          state.installed = true;
        }
      },
      { maxEvents },
    );

    let trigger: TargetTransitionTraceReport["trigger"] = null;
    if (clickQuery) {
      const { locator, count } = await resolveTargetQueryLocator({
        page: target.page,
        parsed: clickQuery,
        preferExactText: clickQuery.mode === "text",
      });
      const selected = await resolveFirstMatch({
        locator,
        count,
        visibleOnly: clickQuery.visibleOnly,
      });
      const preview = await extractTargetQueryPreview(selected.locator);
      await selected.locator.click({
        timeout: opts.timeoutMs,
      });
      trigger = {
        mode: clickQuery.mode,
        query: clickQuery.query,
        selector: clickQuery.selector,
        contains: clickQuery.contains,
        visibleOnly: clickQuery.visibleOnly,
        clicked: {
          index: selected.index,
          text: preview.text,
          visible: selected.visible,
          selectorHint: preview.selectorHint,
        },
      };
    }

    await target.page.waitForTimeout(captureMs);
    const trace = await target.page.evaluate(() => {
      const runtime = globalThis as unknown as {
        __surfwrightTransitionTrace?: {
          dropped: number;
          events: Array<{
            kind: string;
            propertyName: string | null;
            animationName: string | null;
            elapsedMs: number | null;
            selector: string | null;
            text: string | null;
            scrollY: number;
            timeMs: number;
          }>;
        };
      };
      const state = runtime.__surfwrightTransitionTrace;
      if (!state) {
        return {
          dropped: 0,
          events: [],
        };
      }
      const events = state.events.slice();
      state.events = [];
      return {
        dropped: state.dropped,
        events,
      };
    });

    const actionCompletedAt = Date.now();
    const countsByKind: Record<string, number> = {};
    for (const event of trace.events) {
      countsByKind[event.kind] = (countsByKind[event.kind] ?? 0) + 1;
    }

    const report: TargetTransitionTraceReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      actionId: newActionId(),
      captureMs,
      maxEvents,
      trigger,
      eventCount: trace.events.length + trace.dropped,
      emitted: trace.events.length,
      dropped: trace.dropped,
      truncated: trace.dropped > 0,
      countsByKind,
      events: trace.events,
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
        lastActionKind: "transition-trace",
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
