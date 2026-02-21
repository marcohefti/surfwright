import { createCdpEvaluator } from "../cdp/index.js";
import { cdpQueryOp } from "../../click/cdp-query-op.js";

export type ClickCheckStateSample = {
  detached: boolean;
  checked: boolean | null;
  ariaChecked: string | null;
};

export async function readClickCheckStateAt(opts: {
  cdp: import("playwright-core").CDPSession;
  worldCache: Map<string, number>;
  resolveFrameForGlobalIndex: (globalIndex: number) => { frameCdpId: string; localIndex: number };
  globalIndex: number;
  queryMode: "text" | "selector";
  query: string;
  selector: string | null;
  contains: string | null;
  withinSelector: string | null;
}): Promise<ClickCheckStateSample> {
  const resolved = opts.resolveFrameForGlobalIndex(opts.globalIndex);
  const evaluator = createCdpEvaluator({ cdp: opts.cdp, frameCdpId: resolved.frameCdpId, worldCache: opts.worldCache });
  return (await evaluator.evaluate(cdpQueryOp, {
    op: "check-state",
    mode: opts.queryMode,
    query: opts.query,
    selector: opts.selector,
    contains: opts.contains,
    index: resolved.localIndex,
    withinSelector: opts.withinSelector,
  })) as ClickCheckStateSample;
}

export function buildClickCheckStateProof(opts: {
  before: ClickCheckStateSample | null;
  after: ClickCheckStateSample | null;
}): {
  before: { checked: boolean | null; ariaChecked: string | null };
  after: { checked: boolean | null; ariaChecked: string | null };
  changed: boolean | null;
} | null {
  if (!opts.before || !opts.after) {
    return null;
  }
  const before = {
    checked: opts.before.detached ? null : opts.before.checked,
    ariaChecked: opts.before.detached ? null : opts.before.ariaChecked,
  };
  const after = {
    checked: opts.after.detached ? null : opts.after.checked,
    ariaChecked: opts.after.detached ? null : opts.after.ariaChecked,
  };
  return {
    before,
    after,
    changed:
      opts.before.detached || opts.after.detached
        ? null
        : opts.before.checked !== opts.after.checked || opts.before.ariaChecked !== opts.after.ariaChecked,
  };
}
