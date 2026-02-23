import { buildActionProofEnvelope, toActionWaitEvidence } from "../../shared/index.js";
import type { TargetClickDeltaEvidence, TargetClickReport } from "../../types.js";
import { buildClickProof } from "./click-proof.js";

type ClickWaitResult = NonNullable<TargetClickReport["wait"]>;

export function buildClickProofArtifacts(opts: {
  includeProof: boolean;
  requestedTargetId: string;
  urlBeforeClick: string;
  urlAfterClick: string;
  openedTargetId: string | null;
  openedPageDetected: boolean;
  matchCount: number;
  pickedIndex: number;
  waitAfter: {
    mode: "text" | "selector" | "network-idle";
    value: string | null;
  } | null;
  waitTimeoutMs: number;
  waited: ClickWaitResult | null;
  assertions: TargetClickReport["assertions"];
  countAfter: number | null;
  postSnapshot: TargetClickReport["snapshot"];
  delta: TargetClickDeltaEvidence | null;
  clickedText: string;
  clickedSelectorHint: string | null;
  checkState?: {
    before: {
      checked: boolean | null;
      ariaChecked: string | null;
    };
    after: {
      checked: boolean | null;
      ariaChecked: string | null;
    };
    changed: boolean | null;
  } | null;
}): {
  proof: TargetClickReport["proof"] | undefined;
  proofEnvelope: TargetClickReport["proofEnvelope"] | undefined;
} {
  const proof = opts.includeProof
    ? buildClickProof({
        urlBeforeClick: opts.urlBeforeClick,
        urlAfterClick: opts.urlAfterClick,
        openedTargetId: opts.openedTargetId,
        openedPageDetected: opts.openedPageDetected,
        waited: opts.waited,
        postSnapshot: opts.postSnapshot,
        delta: opts.delta,
        clickedText: opts.clickedText,
        clickedSelectorHint: opts.clickedSelectorHint,
        countAfter: opts.countAfter,
        checkState: opts.checkState ?? null,
      })
    : undefined;

  const proofEnvelope = opts.includeProof
    ? buildActionProofEnvelope({
        action: "click",
        urlBefore: opts.urlBeforeClick,
        urlAfter: opts.urlAfterClick,
        targetBefore: opts.requestedTargetId,
        targetAfter: opts.openedTargetId ?? opts.requestedTargetId,
        matchCount: opts.matchCount,
        pickedIndex: opts.pickedIndex,
        wait: toActionWaitEvidence({
          requested: opts.waitAfter ? { ...opts.waitAfter, timeoutMs: opts.waitTimeoutMs } : null,
          observed: opts.waited,
        }),
        assertions: opts.assertions,
        countAfter: opts.countAfter,
        details: proof ? (proof as unknown as Record<string, unknown>) : null,
      })
    : undefined;

  return { proof, proofEnvelope };
}

export function buildClickReport(opts: {
  sessionId: string;
  sessionSource: TargetClickReport["sessionSource"];
  targetId: string;
  actionId: string;
  mode: TargetClickReport["mode"];
  selector: string | null;
  contains: string | null;
  visibleOnly: boolean;
  withinSelector?: string | null;
  query: string;
  matchCount: number;
  pickedIndex: number;
  clicked: TargetClickReport["clicked"];
  url: string;
  title: string;
  wait: ClickWaitResult | null;
  snapshot: TargetClickReport["snapshot"];
  countAfter?: number | null;
  proof: TargetClickReport["proof"] | undefined;
  proofEnvelope: TargetClickReport["proofEnvelope"] | undefined;
  assertions: TargetClickReport["assertions"];
  delta: TargetClickDeltaEvidence | null;
  handoff: TargetClickReport["handoff"];
  resolvedSessionMs: number;
  connectCdpMs: number;
  actionMs: number;
}): TargetClickReport {
  return {
    ok: true,
    sessionId: opts.sessionId,
    sessionSource: opts.sessionSource,
    targetId: opts.targetId,
    actionId: opts.actionId,
    mode: opts.mode,
    selector: opts.selector,
    contains: opts.contains,
    visibleOnly: opts.visibleOnly,
    ...(typeof opts.withinSelector === "string" ? { withinSelector: opts.withinSelector } : {}),
    query: opts.query,
    matchCount: opts.matchCount,
    pickedIndex: opts.pickedIndex,
    clicked: opts.clicked,
    url: opts.url,
    title: opts.title,
    wait: opts.wait,
    snapshot: opts.snapshot,
    ...(typeof opts.countAfter !== "undefined" ? { countAfter: opts.countAfter } : {}),
    ...(opts.proof ? { proof: opts.proof } : {}),
    ...(opts.proofEnvelope ? { proofEnvelope: opts.proofEnvelope } : {}),
    ...(opts.assertions ? { assertions: opts.assertions } : {}),
    ...(opts.delta ? { delta: opts.delta } : {}),
    handoff: opts.handoff,
    timingMs: {
      total: 0,
      resolveSession: opts.resolvedSessionMs,
      connectCdp: opts.connectCdpMs,
      action: opts.actionMs,
      persistState: 0,
    },
  };
}
