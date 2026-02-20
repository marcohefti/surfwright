import type { CDPSession, Page } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { nowIso, saveTargetSnapshot } from "../../state/index.js";
import type { SessionSource, TargetClickDeltaEvidence, TargetClickReport } from "../../types.js";
import { type CdpEvaluator, type CdpFrameTree } from "../infra/cdp/index.js";
import { safePageTitle } from "../infra/utils/safe-page-title.js";
import { parseBackendNodeHandle } from "../infra/utils/element-handle.js";
import { readPageTargetId } from "../infra/targets.js";
import { cdpClickBackendNodeId, cdpDescribeBackendNode } from "./cdp-click-backend-node.js";
import { buildClickDeltaEvidence, captureClickDeltaState, CLICK_DELTA_ARIA_ATTRIBUTES } from "./click-delta.js";
import { buildClickProof } from "./click-proof.js";
import { readPostSnapshot } from "./click-utils.js";
import { waitAfterClickWithBudget } from "./click-wait.js";
import { evaluateActionAssertions, type ParsedActionAssertions } from "../../shared/index.js";
import { buildActionProofEnvelope, toActionWaitEvidence } from "../../shared/index.js";

export async function targetClickByHandle(opts: {
  startedAt: number;
  resolvedSessionAt: number;
  connectedAt: number;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  page: Page;
  cdp: CDPSession;
  frameTree: CdpFrameTree;
  worldCache: Map<string, number>;
  mainEvaluator: CdpEvaluator;
  handleQuery: string;
  timeoutMs: number;
  waitTimeoutMs: number;
  waitAfter: { mode: "text" | "selector" | "network-idle"; value: string | null } | null;
  snapshot: boolean;
  includeDelta: boolean;
  includeProof: boolean;
  parsedAssertions: ParsedActionAssertions;
  persistState: boolean;
}): Promise<TargetClickReport> {
  const backendNodeId = parseBackendNodeHandle(opts.handleQuery);

  const emptyAriaValues = () =>
    Object.fromEntries([...CLICK_DELTA_ARIA_ATTRIBUTES].map((name) => [name, null])) as Record<string, string | null>;
  const readAriaByHandle = async () => {
    try {
      const described = await cdpDescribeBackendNode({ cdp: opts.cdp, backendNodeId });
      const values: Record<string, string | null> = emptyAriaValues();
      for (const name of CLICK_DELTA_ARIA_ATTRIBUTES) {
        values[name] = typeof described.attributes[name] === "string" ? described.attributes[name] : null;
      }
      return { detached: false, values };
    } catch {
      return { detached: true, values: emptyAriaValues() };
    }
  };

  const clickedPreview = await cdpDescribeBackendNode({ cdp: opts.cdp, backendNodeId }).catch(() => ({
    selectorHint: null,
    text: "",
    attributes: {},
  }));
  const context = opts.page.context();
  const pagesBeforeClick = context.pages();
  const urlBeforeClick = opts.page.url();

  const deltaBefore = opts.includeDelta ? await captureClickDeltaState(opts.page, opts.mainEvaluator, opts.timeoutMs) : null;
  const clickedAriaBefore = opts.includeDelta ? await readAriaByHandle() : null;

  await cdpClickBackendNodeId({ cdp: opts.cdp, backendNodeId });

  await opts.page
    .waitForLoadState("domcontentloaded", {
      timeout: Math.max(200, Math.min(1000, opts.timeoutMs)),
    })
    .catch(() => {
      // Not all clicks trigger navigation; this is best-effort only.
    });

  const waited = await waitAfterClickWithBudget({
    waitAfter: opts.waitAfter,
    waitTimeoutMs: opts.waitTimeoutMs,
    page: opts.page,
    cdp: opts.cdp,
    frameTree: opts.frameTree,
    worldCache: opts.worldCache,
    queryMode: "handle",
    query: opts.handleQuery,
    visibleOnly: false,
    frameScope: "main",
  });

  const postSnapshot = opts.snapshot ? await readPostSnapshot(opts.mainEvaluator) : null;
  const assertions = await evaluateActionAssertions({
    page: opts.page,
    assertions: opts.parsedAssertions,
  });
  const deltaAfter = opts.includeDelta ? await captureClickDeltaState(opts.page, opts.mainEvaluator, opts.timeoutMs) : null;
  const clickedAriaAfter = opts.includeDelta ? await readAriaByHandle() : null;

  const openedPage = context.pages().find((page) => !pagesBeforeClick.includes(page)) ?? null;
  let openedTargetId: string | null = null;
  let openedUrl: string | null = null;
  let openedTitle: string | null = null;
  if (openedPage) {
    await openedPage
      .waitForLoadState("domcontentloaded", {
        timeout: Math.max(200, Math.min(1000, opts.timeoutMs)),
      })
      .catch(() => {
        // Best-effort stabilization only.
      });
    openedUrl = openedPage.url();
    openedTitle = await safePageTitle(openedPage, opts.timeoutMs).catch(() => "");
    openedTargetId = await readPageTargetId(context, openedPage).catch(() => null);
  }

  const actionCompletedAt = Date.now();

  let delta: TargetClickDeltaEvidence | null = null;
  if (opts.includeDelta && deltaBefore && deltaAfter && clickedAriaBefore && clickedAriaAfter) {
    delta = buildClickDeltaEvidence({
      before: deltaBefore,
      after: deltaAfter,
      clickedAriaBefore,
      clickedAriaAfter,
    });
  }

  const proof = opts.includeProof
    ? buildClickProof({
        urlBeforeClick,
        urlAfterClick: opts.page.url(),
        openedTargetId,
        openedPageDetected: openedPage !== null,
        waited,
        postSnapshot,
      delta,
      clickedText: clickedPreview.text,
      clickedSelectorHint: clickedPreview.selectorHint,
      countAfter: null,
    })
  : null;
  const proofEnvelope = opts.includeProof
    ? buildActionProofEnvelope({
        action: "click",
        urlBefore: urlBeforeClick,
        urlAfter: opts.page.url(),
        targetBefore: opts.targetId,
        targetAfter: openedTargetId ?? opts.targetId,
        matchCount: 1,
        pickedIndex: 0,
        wait: toActionWaitEvidence({
          requested: opts.waitAfter ? { ...opts.waitAfter, timeoutMs: opts.waitTimeoutMs } : null,
          observed: waited,
        }),
        assertions,
        countAfter: null,
        details: proof ? (proof as unknown as Record<string, unknown>) : null,
      })
    : null;

  const report: TargetClickReport = {
    ok: true,
    sessionId: opts.sessionId,
    sessionSource: opts.sessionSource,
    targetId: opts.targetId,
    actionId: newActionId(),
    mode: "handle",
    selector: null,
    contains: null,
    visibleOnly: false,
    query: opts.handleQuery,
    matchCount: 1,
    pickedIndex: 0,
    clicked: {
      index: 0,
      text: clickedPreview.text,
      visible: true,
      selectorHint: clickedPreview.selectorHint,
      handle: opts.handleQuery,
    },
    url: opts.page.url(),
    title: await safePageTitle(opts.page, opts.timeoutMs),
    wait: waited,
    snapshot: postSnapshot,
    ...(proof ? { proof } : {}),
    ...(proofEnvelope ? { proofEnvelope } : {}),
    ...(assertions ? { assertions } : {}),
    ...(delta ? { delta } : {}),
    handoff: {
      sameTarget: openedPage === null,
      openedTargetId,
      openedUrl,
      openedTitle,
    },
    timingMs: {
      total: 0,
      resolveSession: opts.resolvedSessionAt - opts.startedAt,
      connectCdp: opts.connectedAt - opts.resolvedSessionAt,
      action: actionCompletedAt - opts.connectedAt,
      persistState: 0,
    },
  };

  const persistStartedAt = Date.now();
  if (opts.persistState) {
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
  report.timingMs.total = persistedAt - opts.startedAt;

  return report;
}
