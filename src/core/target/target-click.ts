import { chromium, type Locator } from "playwright-core";
import { newActionId } from "../action-id.js";
import { CliError } from "../errors.js";
import { nowIso } from "../state.js";
import { saveTargetSnapshot } from "../state-repos/target-repo.js";
import { extractTargetQueryPreview, parseTargetQueryInput, resolveTargetQueryLocator } from "./target-query.js";
import { ensureValidSelector, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "./targets.js";
import type { TargetClickReport } from "../types.js";

function parseWaitAfterClick(opts: {
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

async function resolveFirstMatch(opts: {
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

async function waitAfterClick(opts: {
  page: { getByText(text: string, options: { exact: boolean }): Locator; locator(query: string): Locator; waitForLoadState(state: "networkidle" | "domcontentloaded", options: { timeout: number }): Promise<void> };
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

async function readPostSnapshot(page: {
  evaluate<T, Arg>(fn: (arg: Arg) => T, arg: Arg): Promise<T>;
}): Promise<{ textPreview: string }> {
  return await page.evaluate(
    ({ maxChars }: { maxChars: number }) => {
      const runtime = globalThis as unknown as { document?: any };
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const body = runtime.document?.body ?? null;
      const textRaw = body?.innerText ?? "";
      return {
        textPreview: normalize(textRaw).slice(0, maxChars),
      };
    },
    { maxChars: 500 },
  );
}

export async function targetClick(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
  waitForText?: string;
  waitForSelector?: string;
  waitNetworkIdle?: boolean;
  snapshot?: boolean;
}): Promise<TargetClickReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseTargetQueryInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    containsQuery: opts.containsQuery,
    visibleOnly: opts.visibleOnly,
  });
  const waitAfter = parseWaitAfterClick({
    waitForText: opts.waitForText,
    waitForSelector: opts.waitForSelector,
    waitNetworkIdle: opts.waitNetworkIdle,
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

    await selected.locator.click({
      timeout: opts.timeoutMs,
    });

    await target.page
      .waitForLoadState("domcontentloaded", {
        timeout: Math.max(200, Math.min(1000, opts.timeoutMs)),
      })
      .catch(() => {
        // Not all clicks trigger navigation; this is best-effort only.
      });

    const waited = await waitAfterClick({
      page: target.page as any,
      waitAfter,
      timeoutMs: opts.timeoutMs,
    });

    const postSnapshot = opts.snapshot ? await readPostSnapshot(target.page as any) : null;
    const actionCompletedAt = Date.now();

    const report: TargetClickReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      actionId: newActionId(),
      mode: parsed.mode,
      selector: parsed.selector,
      contains: parsed.contains,
      visibleOnly: parsed.visibleOnly,
      query: parsed.query,
      clicked: {
        index: selected.index,
        text: preview.text,
        visible: selected.visible,
        selectorHint: preview.selectorHint,
      },
      url: target.page.url(),
      title: await target.page.title(),
      wait: waited,
      snapshot: postSnapshot,
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
        url: report.url,
        title: report.title,
        status: null,
        lastActionId: report.actionId,
        lastActionAt: nowIso(),
        lastActionKind: "click",
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
