import { chromium, type Locator } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso, saveTargetSnapshot } from "../../state/index.js";
import { extractTargetQueryPreview, parseTargetQueryInput, resolveTargetQueryLocator } from "../infra/target-query.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../infra/targets.js";
import type { BrowserNodeLike, BrowserRuntimeLike } from "../infra/types/browser-dom-types.js";
import { parsePropertiesCsv } from "./parse.js";
import { resolveFirstMatch } from "./query-match.js";
import type { TargetStyleReport } from "./types.js";

const DEFAULT_STYLE_PROPERTIES = ["background-color", "color", "font-size", "border-radius"];
const STYLE_CLASS_NAME_MAX_CHARS = 180;
const STYLE_PRESETS = {
  "button-primary": ["background-color", "color", "font-size", "border-radius", "padding", "border-color"],
  "input-text": ["color", "font-size", "border-color", "border-radius", "background-color", "line-height"],
  "link-primary": ["color", "text-decoration-line", "font-weight", "font-size"],
} as const;
type StylePreset = keyof typeof STYLE_PRESETS;

function parseStylePreset(input: string | undefined): StylePreset | null {
  const raw = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (raw.length === 0) {
    return null;
  }
  if (raw in STYLE_PRESETS) {
    return raw as StylePreset;
  }
  throw new CliError(
    "E_QUERY_INVALID",
    `kind must be one of: ${Object.keys(STYLE_PRESETS).join(", ")}`,
  );
}

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
  kind?: string;
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
  const preset = parseStylePreset(opts.kind);
  const properties = parsePropertiesCsv(
    opts.propertiesCsv,
    preset ? [...STYLE_PRESETS[preset]] : DEFAULT_STYLE_PROPERTIES,
  );
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
      (node: BrowserNodeLike, input: { properties: string[]; maxClassNameChars: number }) => {
        const runtime = globalThis as unknown as BrowserRuntimeLike;
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
    const inspected = {
      index: selected.index,
      text: preview.text,
      visible: selected.visible,
      selectorHint: preview.selectorHint,
      tagName: measured.tagName,
      id: measured.id,
      className: measured.className,
    };
    const values = measured.values;

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
      inspected,
      // Compatibility alias for evaluators that expect element/computed keys.
      element: inspected,
      properties,
      values,
      // Compatibility alias for evaluators that expect element/computed keys.
      computed: values,
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
