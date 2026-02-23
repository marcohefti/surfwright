import type { Locator, Page } from "playwright-core";
import { CliError } from "../../errors.js";
import { extractTargetQueryPreview } from "../infra/target-query.js";
import { ensureValidSelector } from "../infra/targets.js";
import type { TargetClickExplainReport } from "../../types.js";
import type { BrowserRuntimeLike } from "../infra/types/browser-dom-types.js";

export const CLICK_EXPLAIN_MAX_REJECTED = 10;

export function resolveWaitTimeoutMs(waitTimeoutMs: number | undefined, timeoutMs: number): number {
  const value = typeof waitTimeoutMs === "number" ? waitTimeoutMs : timeoutMs;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new CliError("E_QUERY_INVALID", "wait-timeout-ms must be a positive integer");
  }
  return value;
}

export function waitTimeoutError(opts: {
  mode: "text" | "selector" | "network-idle";
  value: string | null;
  timeoutMs: number;
  queryMode: "text" | "selector" | "handle";
  query: string;
  visibleOnly: boolean;
  frameScope: "main" | "all";
}): CliError {
  const waitLabel = opts.mode === "network-idle" ? "network idle" : `${opts.mode} visibility`;
  const hints: string[] = [
    `Wait mode ${waitLabel} exceeded wait-timeout-ms=${opts.timeoutMs}`,
    "Retry with a smaller, explicit wait target or a larger --wait-timeout-ms budget",
  ];
  if (opts.frameScope === "main") {
    hints.push("If content is inside an iframe, retry with --frame-scope all");
  }
  return new CliError("E_WAIT_TIMEOUT", "wait condition did not complete before timeout", {
    hints,
    hintContext: {
      waitMode: opts.mode,
      waitValue: opts.value,
      waitTimeoutMs: opts.timeoutMs,
      queryMode: opts.queryMode,
      query: opts.query,
      visibleOnly: opts.visibleOnly,
      frameScope: opts.frameScope,
    },
  });
}

export function queryMismatchError(opts: {
  message: string;
  reason: "no_match" | "no_visible_match" | "index_out_of_range" | "not_visible_at_index" | "click_resolution_failed";
  queryMode: "text" | "selector";
  query: string;
  visibleOnly: boolean;
  withinSelector?: string | null;
  frameScope: "main" | "all";
  frameCount: number;
  matchCount: number;
  requestedIndex: number | null;
  candidateSummary?: string | null;
}): CliError {
  const hints: string[] = [];
  if (opts.frameScope === "main" && opts.frameCount > 1) {
    hints.push("Retry with --frame-scope all to include iframe content");
  }
  if (opts.reason === "no_visible_match" || opts.reason === "not_visible_at_index") {
    hints.push("Retry without --visible-only to inspect hidden matches");
  }
  if (opts.reason === "index_out_of_range") {
    hints.push("Use --explain or target find first to inspect matchCount before choosing --index/--nth");
  }
  if (opts.reason === "no_match" || opts.reason === "click_resolution_failed") {
    hints.push("Retry with --explain to inspect candidate/rejection evidence");
  }
  if (typeof opts.withinSelector === "string" && opts.withinSelector.trim().length > 0) {
    hints.push("Scope may be too narrow; retry without --within or adjust the scoping selector");
  } else if (opts.reason === "no_match" || opts.reason === "click_resolution_failed") {
    hints.push("Use --within <selector> to scope disambiguation on dense pages");
  }
  if (typeof opts.candidateSummary === "string" && opts.candidateSummary.trim().length > 0) {
    hints.push(`Candidate sample: ${opts.candidateSummary}`);
  }
  return new CliError("E_QUERY_INVALID", opts.message, {
    hints: hints.slice(0, 3),
    hintContext: {
      reason: opts.reason,
      queryMode: opts.queryMode,
      query: opts.query,
      visibleOnly: opts.visibleOnly,
      withinSelector: opts.withinSelector ?? null,
      frameScope: opts.frameScope,
      frameCount: opts.frameCount,
      matchCount: opts.matchCount,
      requestedIndex: opts.requestedIndex,
      candidateSummary: opts.candidateSummary ?? null,
    },
  });
}

export async function pollUntil(opts: { timeoutMs: number; intervalMs: number; check: () => Promise<boolean> }): Promise<number> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < opts.timeoutMs) {
    if (await opts.check()) {
      return Date.now() - startedAt;
    }
    await new Promise((resolve) => setTimeout(resolve, opts.intervalMs));
  }
  throw new CliError("E_WAIT_TIMEOUT", "wait condition did not complete before timeout");
}

export function parseWaitAfterClick(opts: {
  waitForText?: string;
  waitForSelector?: string;
  waitNetworkIdle?: boolean;
}): { mode: "text" | "selector" | "network-idle"; value: string | null } | null {
  const text = typeof opts.waitForText === "string" ? opts.waitForText.trim() : "";
  const selector = typeof opts.waitForSelector === "string" ? opts.waitForSelector.trim() : "";
  const networkIdle = Boolean(opts.waitNetworkIdle);

  const selected = Number(text.length > 0) + Number(selector.length > 0) + Number(networkIdle);
  if (selected === 0) {
    return null;
  }
  if (selected > 1) {
    throw new CliError(
      "E_QUERY_INVALID",
      "Provide at most one post-click wait: --wait-for-text, --wait-for-selector, or --wait-network-idle",
    );
  }

  if (text.length > 0) {
    return { mode: "text", value: text };
  }
  if (selector.length > 0) {
    return { mode: "selector", value: selector };
  }
  return { mode: "network-idle", value: null };
}

export function parseMatchIndex(input: number | undefined): number | null {
  if (typeof input === "undefined") {
    return null;
  }
  if (!Number.isFinite(input) || !Number.isInteger(input) || input < 0) {
    throw new CliError("E_QUERY_INVALID", "index must be a non-negative integer");
  }
  return input;
}

export function parseExpectedCountAfter(input: number | undefined): number | null {
  if (typeof input !== "number") {
    return null;
  }
  if (!Number.isFinite(input) || !Number.isInteger(input) || input < 0) {
    throw new CliError("E_QUERY_INVALID", "expect-count-after must be a non-negative integer");
  }
  return input;
}

export function assertExpectedCountAfter(opts: {
  expectedCountAfter: number | null;
  countAfter: number | null;
  queryMode: "text" | "selector" | "handle";
  selector: string | null;
}): void {
  if (opts.expectedCountAfter === null) {
    return;
  }
  if (opts.queryMode !== "selector") {
    throw new CliError("E_QUERY_INVALID", "--expect-count-after requires selector query mode");
  }
  if (opts.countAfter === null) {
    throw new CliError("E_ASSERT_FAILED", "assertion failed: count-after unavailable", {
      hints: ["Retry once after navigation settles", "Use --proof to capture additional post-click evidence"],
      hintContext: {
        assertionId: "count-after",
        expected: opts.expectedCountAfter,
        actual: null,
        queryMode: opts.queryMode,
        selector: opts.selector,
      },
    });
  }
  if (opts.countAfter !== opts.expectedCountAfter) {
    throw new CliError("E_ASSERT_FAILED", "assertion failed: count-after", {
      hints: ["Verify selector specificity", "Use --count-after to inspect post-click count without assertion"],
      hintContext: {
        assertionId: "count-after",
        expected: opts.expectedCountAfter,
        actual: opts.countAfter,
        queryMode: opts.queryMode,
        selector: opts.selector,
      },
    });
  }
}

export async function resolveFirstMatch(opts: {
  locator: Locator;
  count: number;
  visibleOnly: boolean;
}): Promise<{
  locator: Locator;
  index: number;
  visible: boolean;
}> {
  for (let idx = 0; idx < opts.count; idx += 1) {
    const candidate = opts.locator.nth(idx);
    let visible = false;
    try {
      visible = await candidate.isVisible();
    } catch {
      visible = false;
    }
    if (opts.visibleOnly && !visible) {
      continue;
    }
    return {
      locator: candidate,
      index: idx,
      visible,
    };
  }

  throw new CliError(
    "E_QUERY_INVALID",
    opts.visibleOnly ? "No visible element matched click query" : "No element matched click query",
  );
}

export async function resolveMatchByIndex(opts: {
  locator: Locator;
  count: number;
  index: number;
  visibleOnly: boolean;
}): Promise<{
  locator: Locator;
  index: number;
  visible: boolean;
}> {
  if (opts.index >= opts.count) {
    throw new CliError("E_QUERY_INVALID", `index out of range: requested ${opts.index}, matchCount ${opts.count}`);
  }
  const candidate = opts.locator.nth(opts.index);
  let visible = false;
  try {
    visible = await candidate.isVisible();
  } catch {
    visible = false;
  }
  if (opts.visibleOnly && !visible) {
    throw new CliError("E_QUERY_INVALID", `matched element at index ${opts.index} is not visible`);
  }
  return { locator: candidate, index: opts.index, visible };
}

export async function waitAfterClick(opts: {
  page: Page;
  waitAfter: { mode: "text" | "selector" | "network-idle"; value: string | null } | null;
  timeoutMs: number;
}): Promise<{ mode: "text" | "selector" | "network-idle"; value: string | null } | null> {
  if (!opts.waitAfter) {
    return null;
  }

  if (opts.waitAfter.mode === "text") {
    await opts.page.getByText(opts.waitAfter.value ?? "", { exact: false }).first().waitFor({
      state: "visible",
      timeout: opts.timeoutMs,
    });
    return opts.waitAfter;
  }

  if (opts.waitAfter.mode === "selector") {
    const selector = opts.waitAfter.value ?? "";
    await ensureValidSelector(opts.page, selector);
    await opts.page.locator(selector).first().waitFor({
      state: "visible",
      timeout: opts.timeoutMs,
    });
    return opts.waitAfter;
  }

  await opts.page.waitForLoadState("networkidle", {
    timeout: opts.timeoutMs,
  });
  return opts.waitAfter;
}

export async function readPostSnapshot(evaluator: {
  evaluate<T, Arg>(fn: (arg: Arg) => T, arg: Arg): Promise<T>;
}): Promise<{ textPreview: string }> {
  return await evaluator.evaluate(
    ({ maxChars }: { maxChars: number }) => {
      const runtime = globalThis as unknown as BrowserRuntimeLike;
      const normalize = (value: string): string => value.replace(/\\s+/g, " ").trim();
      const body = runtime.document?.body ?? null;
      const textRaw = body?.innerText ?? "";
      return {
        textPreview: normalize(textRaw).slice(0, maxChars),
      };
    },
    { maxChars: 500 },
  );
}

export async function explainSelection(opts: {
  locator: Locator;
  count: number;
  visibleOnly: boolean;
  requestedIndex: number | null;
}): Promise<{
  matchCount: number;
  requestedIndex: number | null;
  pickedIndex: number | null;
  picked: TargetClickExplainReport["picked"];
  rejected: TargetClickExplainReport["rejected"];
  rejectedTruncated: boolean;
  reason: TargetClickExplainReport["reason"];
}> {
  const matchCount = opts.count;
  const requestedIndex = opts.requestedIndex;

  if (matchCount < 1) {
    return {
      matchCount,
      requestedIndex,
      pickedIndex: null,
      picked: null,
      rejected: [],
      rejectedTruncated: false,
      reason: "no_match",
    };
  }

  if (requestedIndex !== null) {
    if (requestedIndex >= matchCount) {
      return {
        matchCount,
        requestedIndex,
        pickedIndex: null,
        picked: null,
        rejected: [],
        rejectedTruncated: false,
        reason: "index_out_of_range",
      };
    }

    const locator = opts.locator.nth(requestedIndex);
    let visible = false;
    try {
      visible = await locator.isVisible();
    } catch {
      visible = false;
    }
    const preview = await extractTargetQueryPreview(locator);
    if (opts.visibleOnly && !visible) {
      return {
        matchCount,
        requestedIndex,
        pickedIndex: null,
        picked: null,
        rejected: [
          {
            index: requestedIndex,
            reason: "not_visible",
            visible,
            text: preview.text,
            selectorHint: preview.selectorHint,
          },
        ],
        rejectedTruncated: false,
        reason: "no_visible_match",
      };
    }

    return {
      matchCount,
      requestedIndex,
      pickedIndex: requestedIndex,
      picked: {
        index: requestedIndex,
        text: preview.text,
        visible,
        selectorHint: preview.selectorHint,
      },
      rejected: [],
      rejectedTruncated: false,
      reason: null,
    };
  }

  if (!opts.visibleOnly) {
    const locator = opts.locator.nth(0);
    let visible = false;
    try {
      visible = await locator.isVisible();
    } catch {
      visible = false;
    }
    const preview = await extractTargetQueryPreview(locator);
    return {
      matchCount,
      requestedIndex,
      pickedIndex: 0,
      picked: {
        index: 0,
        text: preview.text,
        visible,
        selectorHint: preview.selectorHint,
      },
      rejected: [],
      rejectedTruncated: false,
      reason: null,
    };
  }

  const rejected: TargetClickExplainReport["rejected"] = [];
  let rejectedTruncated = false;
  for (let idx = 0; idx < matchCount; idx += 1) {
    const locator = opts.locator.nth(idx);
    let visible = false;
    try {
      visible = await locator.isVisible();
    } catch {
      visible = false;
    }
    if (!visible) {
      if (rejected.length >= CLICK_EXPLAIN_MAX_REJECTED) {
        rejectedTruncated = true;
        continue;
      }
      const preview = await extractTargetQueryPreview(locator);
      rejected.push({
        index: idx,
        reason: "not_visible",
        visible,
        text: preview.text,
        selectorHint: preview.selectorHint,
      });
      continue;
    }
    const preview = await extractTargetQueryPreview(locator);
    return {
      matchCount,
      requestedIndex,
      pickedIndex: idx,
      picked: {
        index: idx,
        text: preview.text,
        visible,
        selectorHint: preview.selectorHint,
      },
      rejected,
      rejectedTruncated,
      reason: null,
    };
  }

  return {
    matchCount,
    requestedIndex,
    pickedIndex: null,
    picked: null,
    rejected,
    rejectedTruncated: rejectedTruncated || matchCount > rejected.length,
    reason: "no_visible_match",
  };
}

export async function summarizeCandidatePreviews(opts: {
  matchCount: number;
  limit: number;
  previewAt: (index: number) => Promise<{ visible: boolean; text: string; selectorHint: string | null }>;
}): Promise<string | null> {
  if (opts.matchCount < 1 || opts.limit < 1) {
    return null;
  }
  const max = Math.min(opts.limit, opts.matchCount);
  const rows: string[] = [];
  for (let idx = 0; idx < max; idx += 1) {
    const preview = await opts.previewAt(idx).catch(() => null);
    if (!preview) {
      continue;
    }
    const text = preview.text.trim().replace(/\s+/g, " ").slice(0, 40);
    const selectorHint = preview.selectorHint ?? "?";
    rows.push(`#${idx} ${preview.visible ? "visible" : "hidden"} ${selectorHint} "${text}"`);
  }
  return rows.length > 0 ? rows.join(" | ") : null;
}
