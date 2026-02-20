import type { CDPSession } from "playwright-core";
import type { TargetClickDeltaEvidence, TargetClickReport } from "../../types.js";
import { createCdpEvaluator, frameIdsForScope, getCdpFrameTree } from "../infra/cdp/index.js";
import { cdpQueryOp } from "./cdp-query-op.js";

type ClickWaitResult = NonNullable<TargetClickReport["wait"]>;

export async function readSelectorCountAfter(opts: {
  enabled: boolean;
  cdp: CDPSession;
  worldCache: Map<string, number>;
  queryMode: "text" | "selector";
  frameScope: "main" | "all";
  withinSelector?: string | null;
  query: string;
  selector: string | null;
  contains: string | null;
}): Promise<number | null> {
  if (!opts.enabled || opts.queryMode !== "selector" || typeof opts.selector !== "string" || opts.selector.length < 1) {
    return null;
  }
  try {
    const liveFrameTree = await getCdpFrameTree(opts.cdp);
    const liveFrameIds = frameIdsForScope({ frameTree: liveFrameTree, scope: opts.frameScope });
    let rawCount = 0;
    for (const frameCdpId of liveFrameIds) {
      const evaluator = createCdpEvaluator({ cdp: opts.cdp, frameCdpId, worldCache: opts.worldCache });
      const summary = (await evaluator.evaluate(cdpQueryOp, {
        op: "summary",
        mode: opts.queryMode,
        query: opts.query,
        selector: opts.selector,
        contains: opts.contains,
        withinSelector: opts.withinSelector ?? null,
      })) as { rawCount: number; firstVisibleIndex: number | null };
      rawCount += summary.rawCount;
    }
    return rawCount;
  } catch {
    // Post-action frame state can be transient after navigation; keep proof shape stable with null fallback.
    return null;
  }
}

export function buildClickProof(opts: {
  urlBeforeClick: string;
  urlAfterClick: string;
  openedTargetId: string | null;
  openedPageDetected: boolean;
  waited: ClickWaitResult | null;
  postSnapshot: { textPreview: string } | null;
  delta: TargetClickDeltaEvidence | null;
  clickedText: string;
  clickedSelectorHint: string | null;
  countAfter: number | null;
}): NonNullable<TargetClickReport["proof"]> {
  return {
    urlChanged: opts.urlBeforeClick !== opts.urlAfterClick,
    targetChanged: opts.openedPageDetected,
    waitSatisfied: opts.waited ? opts.waited.satisfied : true,
    snapshotCaptured: opts.postSnapshot !== null,
    deltaCaptured: opts.delta !== null,
    clickedText: opts.clickedText,
    clickedSelectorHint: opts.clickedSelectorHint,
    finalUrl: opts.urlAfterClick,
    openedTargetId: opts.openedTargetId,
    countAfter: opts.countAfter,
  };
}
