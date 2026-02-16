import { chromium } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { extractTargetQueryPreview, parseTargetQueryInput, resolveTargetQueryLocator } from "../infra/target-query.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../infra/targets.js";
import { parsePropertiesCsv, parseSettleMs, parseStepsCsv } from "./parse.js";
import { resolveFirstMatch } from "./query-match.js";
import type { TargetScrollWatchReport } from "./types.js";

const DEFAULT_SCROLL_WATCH_SETTLE_MS = 300;
const DEFAULT_SCROLL_WATCH_PROPERTIES = ["position", "top", "transform", "opacity"];
const DEFAULT_SCROLL_WATCH_MAX_EVENTS = 240;
const MAX_SCROLL_WATCH_MAX_EVENTS = 1000;
const SCROLL_WATCH_MAX_VALUE_CHARS = 300;

function parseMaxEvents(input: number | undefined): number {
  if (typeof input === "undefined") {
    return DEFAULT_SCROLL_WATCH_MAX_EVENTS;
  }
  if (!Number.isFinite(input) || !Number.isInteger(input) || input < 1 || input > MAX_SCROLL_WATCH_MAX_EVENTS) {
    throw new CliError("E_QUERY_INVALID", `max-events must be an integer between 1 and ${MAX_SCROLL_WATCH_MAX_EVENTS}`);
  }
  return input;
}

function splitClassSet(raw: string): Set<string> {
  const parts = raw
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return new Set(parts);
}

export async function targetScrollWatch(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
  propertiesCsv?: string;
  stepsCsv?: string;
  settleMs?: number;
  maxEvents?: number;
}): Promise<TargetScrollWatchReport> {
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
  const properties = parsePropertiesCsv(opts.propertiesCsv, DEFAULT_SCROLL_WATCH_PROPERTIES);
  const requestedSteps = parseStepsCsv(opts.stepsCsv);
  const settleMs = parseSettleMs(opts.settleMs, DEFAULT_SCROLL_WATCH_SETTLE_MS);
  const maxEvents = parseMaxEvents(opts.maxEvents);

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

    const runtimeInfo = await target.page.evaluate(() => {
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

    await target.page.evaluate(
      ({ maxEvents }: { maxEvents: number }) => {
        const runtime = globalThis as unknown as {
          __surfwrightScrollWatch?: {
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
          performance?: { now?: () => number } | null;
          window?: { scrollY?: number } | null;
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

        if (!runtime.__surfwrightScrollWatch) {
          runtime.__surfwrightScrollWatch = {
            installed: false,
            maxEvents,
            dropped: 0,
            events: [],
          };
        }

        const state = runtime.__surfwrightScrollWatch;
        state.maxEvents = maxEvents;
        state.dropped = 0;
        state.events = [];

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

    const samples: TargetScrollWatchReport["samples"] = [];
    for (let idx = 0; idx < requestedSteps.length; idx += 1) {
      const requestedY = requestedSteps[idx];
      const appliedY = Math.max(0, Math.min(requestedY, runtimeInfo.maxScroll));
      await target.page.evaluate(
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
        (node: any, { properties, maxChars }: { properties: string[]; maxChars: number }) => {
          const runtime = globalThis as unknown as {
            getComputedStyle?: (el: unknown) => { getPropertyValue?: (name: string) => string } | null;
            window?: { scrollY?: number } | null;
          };
          const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
          const clipped = (value: string): string => value.slice(0, maxChars);
          const computed: Record<string, string | null> = {};
          for (const property of properties) {
            const value = runtime.getComputedStyle?.(node)?.getPropertyValue?.(property) ?? "";
            const normalized = typeof value === "string" ? value.trim() : "";
            computed[property] = normalized.length > 0 ? clipped(normalized) : null;
          }
          const rect = node?.getBoundingClientRect?.() ?? null;
          return {
            className: clipped(normalize(String(node?.className ?? ""))),
            rectTop: typeof rect?.top === "number" ? Math.round(rect.top * 100) / 100 : null,
            rectBottom: typeof rect?.bottom === "number" ? Math.round(rect.bottom * 100) / 100 : null,
            rectHeight: typeof rect?.height === "number" ? Math.round(rect.height * 100) / 100 : null,
            computed,
            scrollY: Math.round(runtime.window?.scrollY ?? 0),
          };
        },
        { properties, maxChars: SCROLL_WATCH_MAX_VALUE_CHARS },
      );

      samples.push({
        index: idx,
        requestedY,
        appliedY,
        achievedY: observed.scrollY,
        deltaY: observed.scrollY - requestedY,
        className: observed.className,
        rectTop: observed.rectTop,
        rectBottom: observed.rectBottom,
        rectHeight: observed.rectHeight,
        computed: observed.computed,
      });
    }

    const trace = await target.page.evaluate(() => {
      const runtime = globalThis as unknown as {
        __surfwrightScrollWatch?: {
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
      const state = runtime.__surfwrightScrollWatch;
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

    const changes: TargetScrollWatchReport["changes"] = [];
    for (let idx = 1; idx < samples.length; idx += 1) {
      const prev = samples[idx - 1];
      const next = samples[idx];
      const prevClasses = splitClassSet(prev.className);
      const nextClasses = splitClassSet(next.className);
      const classAdded = Array.from(nextClasses).filter((entry) => !prevClasses.has(entry));
      const classRemoved = Array.from(prevClasses).filter((entry) => !nextClasses.has(entry));
      const propertyChanges: Array<{
        property: string;
        from: string | null;
        to: string | null;
      }> = [];

      for (const property of properties) {
        const from = prev.computed[property] ?? null;
        const to = next.computed[property] ?? null;
        if (from !== to) {
          propertyChanges.push({ property, from, to });
        }
      }

      if (classAdded.length > 0 || classRemoved.length > 0 || propertyChanges.length > 0) {
        changes.push({
          fromIndex: prev.index,
          toIndex: next.index,
          fromScrollY: prev.achievedY,
          toScrollY: next.achievedY,
          classAdded,
          classRemoved,
          propertyChanges,
        });
      }
    }

    const countsByKind: Record<string, number> = {};
    for (const event of trace.events) {
      countsByKind[event.kind] = (countsByKind[event.kind] ?? 0) + 1;
    }

    const actionCompletedAt = Date.now();
    const report: TargetScrollWatchReport = {
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
      properties,
      settleMs,
      maxEvents,
      maxScroll: runtimeInfo.maxScroll,
      viewport: {
        width: runtimeInfo.viewportWidth,
        height: runtimeInfo.viewportHeight,
      },
      samples,
      changes,
      changeCount: changes.length,
      transition: {
        eventCount: trace.events.length + trace.dropped,
        emitted: trace.events.length,
        dropped: trace.dropped,
        truncated: trace.dropped > 0,
        countsByKind,
        events: trace.events,
      },
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
        lastActionKind: "scroll-watch",
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
