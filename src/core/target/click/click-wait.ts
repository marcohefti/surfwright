import type { CDPSession, Page } from "playwright-core";
import { CliError } from "../../errors.js";
import { createCdpEvaluator, ensureValidSelectorSyntaxCdp, type CdpFrameTree } from "../infra/cdp/index.js";
import type { TargetClickReport } from "../../types.js";
import { pollUntil, waitTimeoutError } from "./click-utils.js";
import { cdpQueryOp } from "./cdp-query-op.js";

type ClickWaitResult = NonNullable<TargetClickReport["wait"]>;
type ClickWaitSpec = { mode: "text" | "selector" | "network-idle"; value: string | null };

export async function waitAfterClickWithBudget(opts: {
  waitAfter: ClickWaitSpec | null;
  waitTimeoutMs: number;
  page: Page;
  cdp: CDPSession;
  frameTree: CdpFrameTree;
  worldCache: Map<string, number>;
  queryMode: "text" | "selector" | "handle";
  query: string;
  visibleOnly: boolean;
  frameScope: "main" | "all";
}): Promise<ClickWaitResult | null> {
  if (opts.waitAfter === null) {
    return null;
  }
  const waitAfter = opts.waitAfter;
  const waitStartedAt = Date.now();

  if (waitAfter.mode === "network-idle") {
    try {
      await opts.page.waitForLoadState("networkidle", { timeout: opts.waitTimeoutMs });
    } catch (error) {
      if (error instanceof Error && /timeout/i.test(error.message)) {
        throw waitTimeoutError({
          mode: waitAfter.mode,
          value: waitAfter.value,
          timeoutMs: opts.waitTimeoutMs,
          queryMode: opts.queryMode,
          query: opts.query,
          visibleOnly: opts.visibleOnly,
          frameScope: opts.frameScope,
        });
      }
      throw error;
    }
    return {
      mode: waitAfter.mode,
      value: waitAfter.value,
      timeoutMs: opts.waitTimeoutMs,
      elapsedMs: Date.now() - waitStartedAt,
      satisfied: true,
    };
  }

  const waitValue = waitAfter.value ?? "";
  if (waitAfter.mode === "selector") {
    await ensureValidSelectorSyntaxCdp({
      cdp: opts.cdp,
      frameCdpId: opts.frameTree.frame.id,
      worldCache: opts.worldCache,
      selectorQuery: waitValue,
    });
    try {
      await pollUntil({
        timeoutMs: opts.waitTimeoutMs,
        intervalMs: 200,
        check: async () => {
          const evaluator = createCdpEvaluator({
            cdp: opts.cdp,
            frameCdpId: opts.frameTree.frame.id,
            worldCache: opts.worldCache,
          });
          return (await evaluator.evaluate(cdpQueryOp, { op: "wait-selector-visible", waitSelector: waitValue })) as boolean;
        },
      });
    } catch (error) {
      if (error instanceof CliError && error.code === "E_WAIT_TIMEOUT") {
        throw waitTimeoutError({
          mode: waitAfter.mode,
          value: waitAfter.value,
          timeoutMs: opts.waitTimeoutMs,
          queryMode: opts.queryMode,
          query: opts.query,
          visibleOnly: opts.visibleOnly,
          frameScope: opts.frameScope,
        });
      }
      throw error;
    }
    return {
      mode: waitAfter.mode,
      value: waitAfter.value,
      timeoutMs: opts.waitTimeoutMs,
      elapsedMs: Date.now() - waitStartedAt,
      satisfied: true,
    };
  }

  try {
    await pollUntil({
      timeoutMs: opts.waitTimeoutMs,
      intervalMs: 200,
      check: async () => {
        const evaluator = createCdpEvaluator({
          cdp: opts.cdp,
          frameCdpId: opts.frameTree.frame.id,
          worldCache: opts.worldCache,
        });
        return (await evaluator.evaluate(cdpQueryOp, { op: "wait-text-visible", waitText: waitValue })) as boolean;
      },
    });
  } catch (error) {
    if (error instanceof CliError && error.code === "E_WAIT_TIMEOUT") {
      throw waitTimeoutError({
        mode: waitAfter.mode,
        value: waitAfter.value,
        timeoutMs: opts.waitTimeoutMs,
        queryMode: opts.queryMode,
        query: opts.query,
        visibleOnly: opts.visibleOnly,
        frameScope: opts.frameScope,
      });
    }
    throw error;
  }
  return {
    mode: waitAfter.mode,
    value: waitAfter.value,
    timeoutMs: opts.waitTimeoutMs,
    elapsedMs: Date.now() - waitStartedAt,
    satisfied: true,
  };
}
