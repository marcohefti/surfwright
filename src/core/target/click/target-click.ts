import { chromium } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { extractTargetQueryPreview, parseTargetQueryInput, resolveTargetQueryLocator } from "../infra/target-query.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../infra/targets.js";
import { createCdpEvaluator, getCdpFrameTree, openCdpSession } from "../infra/cdp/index.js";
import type { TargetClickDeltaEvidence, TargetClickExplainReport, TargetClickReport } from "../../types.js";
import {
  explainSelection,
  parseMatchIndex,
  parseWaitAfterClick,
  readPostSnapshot,
  resolveFirstMatch,
  resolveMatchByIndex,
  waitAfterClick,
} from "./click-utils.js";

const CLICK_DELTA_FOCUS_TEXT_MAX_CHARS = 120;
const CLICK_DELTA_ROLES = ["dialog", "alert", "status", "menu", "listbox"] as const;
const CLICK_DELTA_ARIA_ATTRIBUTES = [
  "aria-expanded",
  "aria-controls",
  "aria-hidden",
  "aria-modal",
  "aria-pressed",
  "aria-selected",
  "aria-checked",
  "aria-disabled",
] as const;

type ClickDeltaFocus = {
  selectorHint: string | null;
  text: string | null;
  textTruncated: boolean;
};

type ClickDeltaRole = (typeof CLICK_DELTA_ROLES)[number];
type ClickDeltaRoleCounts = Record<ClickDeltaRole, number>;

async function captureDeltaProbe(evaluator: {
  evaluate<T, Arg>(fn: (arg: Arg) => T, arg: Arg): Promise<T>;
}): Promise<{
  focus: ClickDeltaFocus;
  roleCounts: ClickDeltaRoleCounts;
}> {
  return await evaluator.evaluate(
    ({
      focusTextMaxChars,
      roles,
    }: {
      focusTextMaxChars: number;
      roles: ClickDeltaRole[];
    }): { focus: ClickDeltaFocus; roleCounts: ClickDeltaRoleCounts } => {
      const runtime = globalThis as unknown as { document?: any };
      const doc = runtime.document;
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();

      const selectorHintFor = (node: any): string | null => {
        const el = node;
        const classListRaw = typeof el?.className === "string" ? normalize(el.className) : "";
        const classSuffix =
          classListRaw.length > 0
            ? classListRaw
                .split(" ")
                .filter((entry) => entry.length > 0)
                .slice(0, 2)
                .map((entry) => `.${entry}`)
                .join("")
            : "";
        const tag = typeof el?.tagName === "string" ? el.tagName.toLowerCase() : "";
        const id = typeof el?.id === "string" && el.id.length > 0 ? `#${el.id}` : "";
        return tag.length > 0 ? `${tag}${id}${classSuffix}` : null;
      };

      const active = doc?.activeElement ?? null;
      const tag = typeof active?.tagName === "string" ? active.tagName.toLowerCase() : "";
      let focusTextRaw = "";
      if (tag === "input" || tag === "textarea" || tag === "select") {
        focusTextRaw =
          active?.getAttribute?.("aria-label") ??
          active?.getAttribute?.("placeholder") ??
          active?.getAttribute?.("name") ??
          active?.id ??
          "";
      } else if (tag === "html" || tag === "body") {
        focusTextRaw = "";
      } else {
        focusTextRaw = active?.innerText ?? active?.textContent ?? active?.getAttribute?.("aria-label") ?? "";
      }
      const focusTextNormalized = normalize(String(focusTextRaw ?? ""));
      const focusText = focusTextNormalized.slice(0, focusTextMaxChars);

      const roleCounts: Partial<Record<ClickDeltaRole, number>> = {};
      for (const role of roles) {
        roleCounts[role] = doc?.querySelectorAll?.(`[role="${role}"]`)?.length ?? 0;
      }

      return {
        focus: {
          selectorHint: selectorHintFor(active),
          text: focusText.length > 0 ? focusText : null,
          textTruncated: focusTextNormalized.length > focusTextMaxChars,
        },
        roleCounts: {
          dialog: roleCounts.dialog ?? 0,
          alert: roleCounts.alert ?? 0,
          status: roleCounts.status ?? 0,
          menu: roleCounts.menu ?? 0,
          listbox: roleCounts.listbox ?? 0,
        },
      };
    },
    {
      focusTextMaxChars: CLICK_DELTA_FOCUS_TEXT_MAX_CHARS,
      roles: [...CLICK_DELTA_ROLES],
    },
  );
}

async function captureDeltaState(page: {
  url(): string;
  title(): Promise<string>;
}, evaluator: {
  evaluate<T, Arg>(fn: (arg: Arg) => T, arg: Arg): Promise<T>;
}): Promise<{
  url: string;
  title: string;
  focus: ClickDeltaFocus;
  roleCounts: ClickDeltaRoleCounts;
}> {
  const url = page.url();
  const [title, probe] = await Promise.all([page.title(), captureDeltaProbe(evaluator)]);
  return {
    url,
    title,
    focus: probe.focus,
    roleCounts: probe.roleCounts,
  };
}

async function captureLocatorAriaAttributes(locator: {
  evaluate<T, Arg>(fn: (element: any, arg: Arg) => T, arg: Arg): Promise<T>;
}): Promise<{
  detached: boolean;
  values: Record<string, string | null>;
}> {
  const attrNames = [...CLICK_DELTA_ARIA_ATTRIBUTES];
  try {
    const values = (await locator.evaluate((el: any, names: string[]) => {
      const out: Record<string, string | null> = {};
      for (const name of names) {
        out[name] = el?.getAttribute?.(name) ?? null;
      }
      return out;
    }, attrNames)) as Record<string, string | null>;
    return { detached: false, values };
  } catch {
    const values: Record<string, string | null> = {};
    for (const name of attrNames) {
      values[name] = null;
    }
    return { detached: true, values };
  }
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
  index?: number;
  explain?: boolean;
  waitForText?: string;
  waitForSelector?: string;
  waitNetworkIdle?: boolean;
  snapshot?: boolean;
  delta?: boolean;
}): Promise<TargetClickReport | TargetClickExplainReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseTargetQueryInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    containsQuery: opts.containsQuery,
    visibleOnly: opts.visibleOnly,
  });
  const requestedIndex = parseMatchIndex(opts.index);
  const explain = Boolean(opts.explain);
  const includeDelta = Boolean(opts.delta);
  const waitAfter = parseWaitAfterClick({
    waitForText: opts.waitForText,
    waitForSelector: opts.waitForSelector,
    waitNetworkIdle: opts.waitNetworkIdle,
  });

  if (explain) {
    const hasPostClickEvidence = Boolean(opts.snapshot) || includeDelta || waitAfter !== null;
    if (hasPostClickEvidence) {
      throw new CliError("E_QUERY_INVALID", "--explain cannot be combined with post-click wait options, --snapshot, or --delta");
    }
  }

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
    const needDomEval = includeDelta || Boolean(opts.snapshot);
    const cdp = needDomEval ? await openCdpSession(target.page) : null;
    const frameTree = cdp ? await getCdpFrameTree(cdp) : null;
    const worldCache = cdp ? new Map<string, number>() : null;
    const mainEvaluator =
      cdp && frameTree && worldCache
        ? createCdpEvaluator({
            cdp,
            frameCdpId: frameTree.frame.id,
            worldCache,
          })
        : null;
    const { locator, count } = await resolveTargetQueryLocator({
      page: target.page,
      parsed,
      preferExactText: parsed.mode === "text",
    });

    if (explain) {
      const selection = await explainSelection({
        locator,
        count,
        visibleOnly: parsed.visibleOnly,
        requestedIndex,
      });
      const actionCompletedAt = Date.now();

      const report: TargetClickExplainReport = {
        ok: true,
        sessionId: session.sessionId,
        sessionSource,
        targetId: requestedTargetId,
        mode: parsed.mode,
        selector: parsed.selector,
        contains: parsed.contains,
        visibleOnly: parsed.visibleOnly,
        query: parsed.query,
        matchCount: selection.matchCount,
        requestedIndex: selection.requestedIndex,
        pickedIndex: selection.pickedIndex,
        picked: selection.picked,
        rejected: selection.rejected,
        rejectedTruncated: selection.rejectedTruncated,
        reason: selection.reason,
        url: target.page.url(),
        title: await target.page.title(),
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
          updatedAt: nowIso(),
        });
      }
      const persistedAt = Date.now();
      report.timingMs.persistState = persistedAt - persistStartedAt;
      report.timingMs.total = persistedAt - startedAt;
      return report;
    }

    const selected =
      requestedIndex === null
        ? await resolveFirstMatch({
            locator,
            count,
            visibleOnly: parsed.visibleOnly,
          })
        : await resolveMatchByIndex({
            locator,
            count,
            index: requestedIndex,
            visibleOnly: parsed.visibleOnly,
          });

    const preview = await extractTargetQueryPreview(selected.locator);

    const deltaBefore = includeDelta && mainEvaluator ? await captureDeltaState(target.page as any, mainEvaluator) : null;
    const clickedAriaBefore = includeDelta ? await captureLocatorAriaAttributes(selected.locator as any) : null;

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

    const postSnapshot = opts.snapshot && mainEvaluator ? await readPostSnapshot(mainEvaluator) : null;
    const deltaAfter = includeDelta && mainEvaluator ? await captureDeltaState(target.page as any, mainEvaluator) : null;
    const clickedAriaAfter = includeDelta ? await captureLocatorAriaAttributes(selected.locator as any) : null;
    const actionCompletedAt = Date.now();

    let delta: TargetClickDeltaEvidence | null = null;
    if (includeDelta && deltaBefore && deltaAfter && clickedAriaBefore && clickedAriaAfter) {
      delta = {
        before: deltaBefore,
        after: deltaAfter,
        clickedAria: {
          detachedAfter: clickedAriaAfter.detached,
          attributes: [...CLICK_DELTA_ARIA_ATTRIBUTES].map((name) => ({
            name,
            before: clickedAriaBefore.values[name] ?? null,
            after: clickedAriaAfter.values[name] ?? null,
          })),
        },
      };
    }

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
      matchCount: count,
      pickedIndex: selected.index,
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
      ...(delta ? { delta } : {}),
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
