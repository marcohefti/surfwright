import type { Locator } from "playwright-core";
import { CliError } from "../../errors.js";
import { extractTargetQueryPreview } from "../infra/target-query.js";
import { ensureValidSelector } from "../infra/targets.js";
import type { TargetClickExplainReport } from "../../types.js";

export const CLICK_EXPLAIN_MAX_REJECTED = 10;

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
  page: {
    getByText(text: string, options: { exact: boolean }): Locator;
    locator(query: string): Locator;
    waitForLoadState(state: "networkidle" | "domcontentloaded", options: { timeout: number }): Promise<void>;
  };
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
    await ensureValidSelector(opts.page as any, selector);
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
      const runtime = globalThis as unknown as { document?: any };
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
