import { chromium } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state.js";
import { saveTargetSnapshot } from "../../state-repos/target-repo.js";
import { extractTargetQueryPreview, parseTargetQueryInput, resolveTargetQueryLocator } from "../target-query.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";
import { parseDurationMs, parseIntervalMs, parseMaxSamples, parsePropertyName } from "./parse.js";
import { resolveFirstMatch } from "./query-match.js";
import type { TargetObserveReport } from "./types.js";

const DEFAULT_OBSERVE_INTERVAL_MS = 400;
const DEFAULT_OBSERVE_DURATION_MS = 3000;
const DEFAULT_OBSERVE_MAX_SAMPLES = 120;
const DEFAULT_OBSERVE_PROPERTY = "transform";
const OBSERVE_MAX_VALUE_CHARS = 300;

export async function targetObserve(opts: {
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
}): Promise<TargetObserveReport> {
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
  const property = parsePropertyName(opts.property, DEFAULT_OBSERVE_PROPERTY);
  const intervalMs = parseIntervalMs(opts.intervalMs, DEFAULT_OBSERVE_INTERVAL_MS);
  const durationMs = parseDurationMs(opts.durationMs, DEFAULT_OBSERVE_DURATION_MS);
  const maxSamples = parseMaxSamples(opts.maxSamples, DEFAULT_OBSERVE_MAX_SAMPLES);

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

    const samples: TargetObserveReport["samples"] = [];
    const samplingStartedAt = Date.now();
    let sampleIndex = 0;
    while (samples.length < maxSamples) {
      if (sampleIndex > 0) {
        const now = Date.now();
        const remainingMs = samplingStartedAt + durationMs - now;
        if (remainingMs <= 0) {
          break;
        }
        await target.page.waitForTimeout(Math.min(intervalMs, remainingMs));
      }

      const measuredAt = Date.now();
      const measured = await selected.locator.evaluate(
        (node: any, { property, maxChars }: { property: string; maxChars: number }) => {
          const runtime = globalThis as unknown as {
            getComputedStyle?: (el: unknown) => { getPropertyValue?: (name: string) => string } | null;
            window?: { scrollY?: number } | null;
          };
          const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
          const clipped = (value: string): string => value.slice(0, maxChars);
          const read = (): string | null => {
            if (property === "text" || property === "innerText" || property === "textContent") {
              return clipped(normalize(String(node?.innerText ?? node?.textContent ?? "")));
            }
            if (property === "class" || property === "className") {
              return clipped(normalize(String(node?.className ?? "")));
            }
            if (property.startsWith("attr:")) {
              const attrName = property.slice("attr:".length).trim();
              if (attrName.length === 0) {
                return null;
              }
              const value = node?.getAttribute?.(attrName);
              return typeof value === "string" ? clipped(value) : null;
            }
            if (property.startsWith("style.")) {
              const inlineName = property.slice("style.".length).trim();
              if (inlineName.length === 0) {
                return null;
              }
              const value = node?.style?.[inlineName];
              return typeof value === "string" && value.length > 0 ? clipped(value) : null;
            }

            const styleValue = runtime.getComputedStyle?.(node)?.getPropertyValue?.(property) ?? "";
            if (typeof styleValue === "string" && styleValue.trim().length > 0) {
              return clipped(styleValue.trim());
            }
            const direct = node?.[property];
            if (typeof direct === "undefined" || direct === null) {
              return null;
            }
            return clipped(typeof direct === "string" ? direct : String(direct));
          };

          return {
            value: read(),
            scrollY: Math.round(runtime.window?.scrollY ?? 0),
          };
        },
        { property, maxChars: OBSERVE_MAX_VALUE_CHARS },
      );
      samples.push({
        index: sampleIndex,
        timeMs: Math.max(0, measuredAt - samplingStartedAt),
        value: measured.value,
        scrollY: measured.scrollY,
      });
      sampleIndex += 1;

      if (measuredAt - samplingStartedAt >= durationMs) {
        break;
      }
    }

    let changes = 0;
    for (let idx = 1; idx < samples.length; idx += 1) {
      if (samples[idx - 1].value !== samples[idx].value) {
        changes += 1;
      }
    }

    const actionCompletedAt = Date.now();
    const report: TargetObserveReport = {
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
      intervalMs,
      durationMs,
      maxSamples,
      sampleCount: samples.length,
      samples,
      changes,
      firstValue: samples[0]?.value ?? null,
      lastValue: samples[samples.length - 1]?.value ?? null,
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
        lastActionKind: "observe",
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
