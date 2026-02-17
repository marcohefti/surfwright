import { chromium } from "playwright-core";
import { CliError } from "../../../errors.js";
import { nowIso, saveTargetSnapshot } from "../../../state/index.js";
import { parseTargetQueryInput } from "../target-query.js";
import { parseFrameScope } from "../target-find.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";
import { createCdpEvaluator, ensureValidSelectorSyntaxCdp, frameIdsForScope, getCdpFrameTree, openCdpSession } from "../cdp/index.js";
import type { TargetCountReport } from "../../../types.js";

export async function targetCount(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
  frameScope?: string;
}): Promise<TargetCountReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseTargetQueryInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    containsQuery: opts.containsQuery,
    visibleOnly: opts.visibleOnly,
  });
  const frameScope = parseFrameScope(opts.frameScope);

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
    const cdp = await openCdpSession(target.page);
    const frameTree = await getCdpFrameTree(cdp);
    const frameIds = frameIdsForScope({ frameTree, scope: frameScope });
    const worldCache = new Map<string, number>();

    if (parsed.mode === "selector" && typeof parsed.selector === "string") {
      await ensureValidSelectorSyntaxCdp({
        cdp,
        frameCdpId: frameTree.frame.id,
        worldCache,
        selectorQuery: parsed.selector,
      });
    }

    let rawCount = 0;
    let visibleCount = 0;

    for (const frameCdpId of frameIds) {
      const evaluator = createCdpEvaluator({ cdp, frameCdpId, worldCache });
      const payload = await evaluator.evaluate(
        ({
          mode,
          query,
          selector,
          contains,
        }: {
          mode: "text" | "selector";
          query: string;
          selector: string | null;
          contains: string | null;
        }) => {
          const runtime = globalThis as unknown as { document?: any; getComputedStyle?: any };
          const doc = runtime.document;
          const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
          const normLower = (value: string): string => normalize(value).toLowerCase();
          const isVisible = (node: any): boolean => {
            if (!node) return false;
            if (node.hasAttribute?.("hidden")) return false;
            const style = runtime.getComputedStyle?.(node);
            if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return false;
            return (node.getClientRects?.().length ?? 0) > 0;
          };
          const textFor = (node: any): string => {
            const el = node;
            const tag = typeof el?.tagName === "string" ? el.tagName.toLowerCase() : "";
            if (tag === "input" || tag === "textarea" || tag === "select") {
              return (
                el?.getAttribute?.("aria-label") ??
                el?.getAttribute?.("placeholder") ??
                el?.getAttribute?.("name") ??
                el?.id ??
                el?.value ??
                ""
              );
            }
            return el?.innerText ?? el?.textContent ?? el?.getAttribute?.("aria-label") ?? el?.getAttribute?.("title") ?? "";
          };

          const root = doc?.body ?? null;
          if (!root) {
            return { rawCount: 0, visibleCount: 0 };
          }

          const containsLower = typeof contains === "string" && contains.trim().length > 0 ? normLower(contains) : null;
          const queryLower = normLower(query);
          let matches: any[] = [];
          if (mode === "selector") {
            const nodes = Array.from(root.querySelectorAll?.(selector ?? "") ?? []);
            matches = containsLower
              ? nodes.filter((node) => normLower(textFor(node)).includes(containsLower))
              : nodes;
          } else {
            const candidateSelector =
              "a,button,input,textarea,select,option,label,summary,[role=\"button\"],[role=\"link\"],[role=\"menuitem\"],[role=\"tab\"],[role=\"checkbox\"],[role=\"radio\"],[role=\"option\"],[role=\"heading\"],h1,h2,h3,h4,h5,h6,[tabindex]:not([tabindex=\"-1\"])";
            const nodes = Array.from(root.querySelectorAll?.(candidateSelector) ?? []);
            const exact = nodes.filter((node) => normLower(textFor(node)) === queryLower);
            const pool = exact.length > 0 ? exact : nodes;
            matches = pool.filter((node) => normLower(textFor(node)).includes(queryLower));
          }

          let visibleCount = 0;
          for (const node of matches) {
            if (isVisible(node)) {
              visibleCount += 1;
            }
          }
          return { rawCount: matches.length, visibleCount };
        },
        {
          mode: parsed.mode,
          query: parsed.query,
          selector: parsed.selector,
          contains: parsed.contains,
        },
      );
      rawCount += payload.rawCount;
      visibleCount += payload.visibleCount;
    }

    const actionCompletedAt = Date.now();
    const count = parsed.visibleOnly ? visibleCount : rawCount;
    const report: TargetCountReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      mode: parsed.mode,
      selector: parsed.selector,
      contains: parsed.contains,
      visibleOnly: parsed.visibleOnly,
      query: parsed.query,
      rawCount,
      count,
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
