import { chromium, type Locator } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso, saveTargetSnapshot } from "../../state/index.js";
import { extractTargetQueryPreview, parseTargetQueryInput, resolveTargetQueryLocator } from "../infra/target-query.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../infra/targets.js";
import { parsePropertiesCsv } from "./parse.js";
import { resolveFirstMatch } from "./query-match.js";
import type { TargetStyleReport } from "./types.js";

const DEFAULT_STYLE_PROPERTIES = ["background-color", "color", "font-size", "border-radius"];
const STYLE_CLASS_NAME_MAX_CHARS = 180;

function parseRequestedIndex(input: number | undefined): number | null {
  if (typeof input === "undefined") {
    return null;
  }
  if (!Number.isInteger(input) || input < 0) {
    throw new CliError("E_QUERY_INVALID", "index must be a non-negative integer");
  }
  return input;
}

export async function targetStyle(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
  propertiesCsv?: string;
  index?: number;
}): Promise<TargetStyleReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseTargetQueryInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    containsQuery: opts.containsQuery,
    visibleOnly: opts.visibleOnly,
  });
  const properties = parsePropertiesCsv(opts.propertiesCsv, DEFAULT_STYLE_PROPERTIES);
  const requestedIndex = parseRequestedIndex(opts.index);

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
    if (count < 1) {
      throw new CliError("E_QUERY_INVALID", parsed.visibleOnly ? "No visible element matched style query" : "No element matched style query");
    }

    let selected: { locator: Locator; index: number; visible: boolean };
    if (requestedIndex !== null) {
      if (requestedIndex >= count) {
        throw new CliError("E_QUERY_INVALID", `index out of range: requested ${requestedIndex}, matchCount ${count}`);
      }
      const candidate = locator.nth(requestedIndex);
      const visible = await candidate.isVisible().catch(() => false);
      if (parsed.visibleOnly && !visible) {
        throw new CliError("E_QUERY_INVALID", `matched element at index ${requestedIndex} is not visible`);
      }
      selected = { locator: candidate, index: requestedIndex, visible };
    } else {
      selected = await resolveFirstMatch({
        locator,
        count,
        visibleOnly: parsed.visibleOnly,
      });
    }

    const preview = await extractTargetQueryPreview(selected.locator);
    const measured = await selected.locator.evaluate(
      (node: any, input: { properties: string[]; maxClassNameChars: number }) => {
        const runtime = globalThis as unknown as {
          getComputedStyle?: (el: unknown) => { getPropertyValue?: (name: string) => string } | null;
        };
        const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
        const styleValues: Record<string, string | null> = {};
        for (const property of input.properties) {
          const value = runtime.getComputedStyle?.(node)?.getPropertyValue?.(property) ?? "";
          const normalized = typeof value === "string" ? value.trim() : "";
          styleValues[property] = normalized.length > 0 ? normalized : null;
        }

        const classNameRaw = normalize(String(node?.className ?? ""));
        const className = classNameRaw.length > input.maxClassNameChars ? classNameRaw.slice(0, input.maxClassNameChars) : classNameRaw;

        return {
          tagName: typeof node?.tagName === "string" ? String(node.tagName).toLowerCase() : null,
          id: typeof node?.id === "string" && node.id.length > 0 ? node.id : null,
          className: className.length > 0 ? className : null,
          values: styleValues,
        };
      },
      { properties, maxClassNameChars: STYLE_CLASS_NAME_MAX_CHARS },
    );

    const actionCompletedAt = Date.now();
    const report: TargetStyleReport = {
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
      matchCount: count,
      pickedIndex: selected.index,
      inspected: {
        index: selected.index,
        text: preview.text,
        visible: selected.visible,
        selectorHint: preview.selectorHint,
        tagName: measured.tagName,
        id: measured.id,
        className: measured.className,
      },
      properties,
      values: measured.values,
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
        lastActionKind: "style",
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
