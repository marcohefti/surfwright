import { chromium } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { parseTargetQueryInput } from "../infra/target-query.js";
import { parseFrameScope } from "../infra/target-find.js";
import { readPageTargetId, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../infra/targets.js";
import { createCdpEvaluator, ensureValidSelectorSyntaxCdp, frameIdsForScope, getCdpFrameTree, openCdpSession } from "../infra/cdp/index.js";
import type { TargetClickDeltaEvidence, TargetClickExplainReport, TargetClickReport } from "../../types.js";
import { CLICK_EXPLAIN_MAX_REJECTED, parseMatchIndex, parseWaitAfterClick, queryMismatchError, readPostSnapshot, resolveWaitTimeoutMs } from "./click-utils.js";
import { cdpQueryOp } from "./cdp-query-op.js";
import { buildClickExplainReport } from "./click-explain.js";
import { buildClickDeltaEvidence, captureClickDeltaState, CLICK_DELTA_ARIA_ATTRIBUTES } from "./click-delta.js";
import { readSelectorCountAfter } from "./click-proof.js";
import { safePageTitle } from "../infra/utils/safe-page-title.js";
import { targetClickByHandle } from "./target-click-handle.js";
import { waitAfterClickWithBudget } from "./click-wait.js";
import { evaluateActionAssertions, parseActionAssertions } from "../../shared/index.js";
import { buildClickProofArtifacts, buildClickReport } from "./click-report.js";
export async function targetClick(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  handle?: string;
  visibleOnly?: boolean;
  frameScope?: string;
  index?: number;
  explain?: boolean;
  waitForText?: string;
  waitForSelector?: string;
  waitNetworkIdle?: boolean;
  waitTimeoutMs?: number;
  snapshot?: boolean;
  delta?: boolean;
  proof?: boolean;
  assertUrlPrefix?: string;
  assertSelector?: string;
  assertText?: string;
}): Promise<TargetClickReport | TargetClickExplainReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const requestedIndex = parseMatchIndex(opts.index);
  const handleQuery = typeof opts.handle === "string" ? opts.handle.trim() : "";
  const hasHandle = handleQuery.length > 0;
  const parsed = hasHandle
    ? null
    : parseTargetQueryInput({
        textQuery: opts.textQuery,
        selectorQuery: opts.selectorQuery,
        containsQuery: opts.containsQuery,
        visibleOnly: opts.visibleOnly,
      });
  const explain = Boolean(opts.explain);
  const includeProof = Boolean(opts.proof);
  const parsedAssertions = parseActionAssertions({
    assertUrlPrefix: opts.assertUrlPrefix,
    assertSelector: opts.assertSelector,
    assertText: opts.assertText,
  });
  const includeDelta = Boolean(opts.delta) || includeProof;
  const includeSnapshot = Boolean(opts.snapshot) || includeProof;
  const waitAfter = parseWaitAfterClick({
    waitForText: opts.waitForText,
    waitForSelector: opts.waitForSelector,
    waitNetworkIdle: opts.waitNetworkIdle,
  });
  const waitTimeoutMs = resolveWaitTimeoutMs(opts.waitTimeoutMs, opts.timeoutMs);
  if (hasHandle) {
    const hasText = typeof opts.textQuery === "string" && opts.textQuery.trim().length > 0;
    const hasSelector = typeof opts.selectorQuery === "string" && opts.selectorQuery.trim().length > 0;
    const hasContains = typeof opts.containsQuery === "string" && opts.containsQuery.trim().length > 0;
    if (hasText || hasSelector || hasContains) throw new CliError("E_QUERY_INVALID", "Use either --handle or a query via --text/--selector/--contains");
    if (requestedIndex !== null) throw new CliError("E_QUERY_INVALID", "--index cannot be combined with --handle");
    if (Boolean(opts.visibleOnly)) throw new CliError("E_QUERY_INVALID", "--visible-only cannot be combined with --handle");
  }
  if (explain) {
    if (hasHandle) throw new CliError("E_QUERY_INVALID", "--explain cannot be combined with --handle");
    const hasPostClickEvidence = includeSnapshot || includeDelta || waitAfter !== null || includeProof;
    if (hasPostClickEvidence) throw new CliError("E_QUERY_INVALID", "--explain cannot be combined with post-click wait options, --snapshot, --delta, or --proof");
  }
  const { session, sessionSource } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: requestedTargetId,
  });
  const resolvedSessionAt = Date.now();
  const frameScope = parseFrameScope(opts.frameScope);
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();
  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    const context = target.page.context();
    const pagesBeforeClick = context.pages();
    const cdp = await openCdpSession(target.page);
    const frameTree = await getCdpFrameTree(cdp);
    const worldCache = new Map<string, number>();
    const frameIds = frameIdsForScope({ frameTree, scope: frameScope });
    if (parsed && parsed.mode === "selector" && typeof parsed.selector === "string") {
      await ensureValidSelectorSyntaxCdp({
        cdp,
        frameCdpId: frameTree.frame.id,
        worldCache,
        selectorQuery: parsed.selector,
      });
    }
    const mainEvaluator = createCdpEvaluator({
      cdp,
      frameCdpId: frameTree.frame.id,
      worldCache,
    });
    if (hasHandle) {
      return await targetClickByHandle({
        startedAt,
        resolvedSessionAt,
        connectedAt,
        sessionId: session.sessionId,
        sessionSource,
        targetId: requestedTargetId,
        page: target.page,
        cdp,
        frameTree,
        worldCache,
        mainEvaluator,
        handleQuery,
        timeoutMs: opts.timeoutMs,
        waitTimeoutMs,
        waitAfter,
        snapshot: includeSnapshot,
        includeDelta,
        includeProof,
        parsedAssertions,
        persistState: opts.persistState !== false,
      });
    }
    if (!parsed) {
      throw new CliError("E_INTERNAL", "Unable to parse click query");
    }
    const queryMode = parsed.mode;
    const query = parsed.query;
    const selector = parsed.selector;
    const contains = parsed.contains;
    const visibleOnly = parsed.visibleOnly;
    const perFrameCounts: Array<{ frameCdpId: string; rawCount: number; firstVisibleIndex: number | null }> = [];
    for (const frameCdpId of frameIds) {
      const evaluator = createCdpEvaluator({ cdp, frameCdpId, worldCache });
      const summary = await evaluator.evaluate(cdpQueryOp, {
        op: "summary",
        mode: queryMode,
        query,
        selector,
        contains,
      }) as { rawCount: number; firstVisibleIndex: number | null };
      perFrameCounts.push({ frameCdpId, rawCount: summary.rawCount, firstVisibleIndex: summary.firstVisibleIndex });
    }
    const matchCount = perFrameCounts.reduce((sum, entry) => sum + entry.rawCount, 0);
    const resolveFrameForGlobalIndex = (globalIndex: number): { frameCdpId: string; localIndex: number; frameOffset: number } => {
      let offset = 0;
      for (const entry of perFrameCounts) {
        if (globalIndex < offset + entry.rawCount) {
          return { frameCdpId: entry.frameCdpId, localIndex: globalIndex - offset, frameOffset: offset };
        }
        offset += entry.rawCount;
      }
      throw new CliError("E_INTERNAL", "Unable to resolve global match index");
    };
    const previewAt = async (globalIndex: number) => {
      const resolved = resolveFrameForGlobalIndex(globalIndex);
      const evaluator = createCdpEvaluator({ cdp, frameCdpId: resolved.frameCdpId, worldCache });
      const payload = await evaluator.evaluate(cdpQueryOp, {
        op: "preview",
        mode: queryMode,
        query,
        selector,
        contains,
        index: resolved.localIndex,
      }) as { ok: boolean; visible?: boolean; text?: string; selectorHint?: string | null };
      if (!payload.ok) {
        throw new CliError("E_INTERNAL", "Unable to read match preview");
      }
      return { visible: Boolean(payload.visible), text: payload.text ?? "", selectorHint: payload.selectorHint ?? null };
    };
    const clickAt = async (globalIndex: number) => {
      const resolved = resolveFrameForGlobalIndex(globalIndex);
      const evaluator = createCdpEvaluator({ cdp, frameCdpId: resolved.frameCdpId, worldCache });
      const clickPointPayload = await evaluator.evaluate(cdpQueryOp, {
        op: "click-point",
        mode: queryMode,
        query,
        selector,
        contains,
        index: resolved.localIndex,
      }) as { ok: boolean; x?: number; y?: number; visible?: boolean; text?: string; selectorHint?: string | null };
      if (clickPointPayload.ok && typeof clickPointPayload.x === "number" && typeof clickPointPayload.y === "number") {
        try {
          await target.page.mouse.click(clickPointPayload.x, clickPointPayload.y);
          return { visible: Boolean(clickPointPayload.visible), text: clickPointPayload.text ?? "", selectorHint: clickPointPayload.selectorHint ?? null };
        } catch {
          // Fall through to DOM click fallback for edge cases (for example, cross-origin iframe coordinates).
        }
      }
      const payload = await evaluator.evaluate(cdpQueryOp, {
        op: "click",
        mode: queryMode,
        query,
        selector,
        contains,
        index: resolved.localIndex,
      }) as { ok: boolean; visible?: boolean; text?: string; selectorHint?: string | null };
      if (!payload.ok) {
        throw queryMismatchError({
          message: visibleOnly ? "No visible element matched click query" : "No element matched click query",
          reason: "click_resolution_failed",
          queryMode,
          query,
          visibleOnly,
          frameScope,
          frameCount: perFrameCounts.length,
          matchCount,
          requestedIndex,
        });
      }
      return { visible: Boolean(payload.visible), text: payload.text ?? "", selectorHint: payload.selectorHint ?? null };
    };
    const readAriaAt = async (globalIndex: number) => {
      const resolved = resolveFrameForGlobalIndex(globalIndex);
      const evaluator = createCdpEvaluator({ cdp, frameCdpId: resolved.frameCdpId, worldCache });
      return (await evaluator.evaluate(cdpQueryOp, {
        op: "aria",
        mode: queryMode,
        query,
        selector,
        contains,
        index: resolved.localIndex,
        attrNames: [...CLICK_DELTA_ARIA_ATTRIBUTES],
      })) as { detached: boolean; values: Record<string, string | null> };
    };
    if (explain) {
      const url = target.page.url();
      const title = await safePageTitle(target.page, opts.timeoutMs);
      const actionCompletedAt = Date.now();
      const report = await buildClickExplainReport({
        startedAt,
        resolvedSessionAt,
        connectedAt,
        actionCompletedAt,
        sessionId: session.sessionId,
        sessionSource,
        targetId: requestedTargetId,
        mode: queryMode,
        selector,
        contains,
        visibleOnly,
        query,
        matchCount,
        requestedIndex,
        url,
        title,
        perFrameCounts,
        previewAt,
        listRejectedInvisible: async ({ frameCdpId, stopExclusive, maxRejected }) => {
          const evaluator = createCdpEvaluator({ cdp, frameCdpId, worldCache });
          return (await evaluator.evaluate(cdpQueryOp, {
            op: "invisible",
            mode: queryMode,
            query,
            selector,
            contains,
            stopExclusive,
            maxRejected,
          })) as { rejected: Array<{ index: number; visible: boolean; text: string; selectorHint: string | null }>; rejectedTruncated: boolean };
        },
      });
      return report as TargetClickExplainReport;
    }
    // Execute click.
    if (matchCount < 1) {
      throw queryMismatchError({
        message: visibleOnly ? "No visible element matched click query" : "No element matched click query",
        reason: visibleOnly ? "no_visible_match" : "no_match",
        queryMode,
        query,
        visibleOnly,
        frameScope,
        frameCount: perFrameCounts.length,
        matchCount,
        requestedIndex,
      });
    }
    let pickedIndex: number;
    if (requestedIndex !== null) {
      if (requestedIndex >= matchCount) {
        throw queryMismatchError({
          message: `index out of range: requested ${requestedIndex}, matchCount ${matchCount}`,
          reason: "index_out_of_range",
          queryMode,
          query,
          visibleOnly,
          frameScope,
          frameCount: perFrameCounts.length,
          matchCount,
          requestedIndex,
        });
      }
      const preview = await previewAt(requestedIndex);
      if (visibleOnly && !preview.visible) {
        throw queryMismatchError({
          message: `matched element at index ${requestedIndex} is not visible`,
          reason: "not_visible_at_index",
          queryMode,
          query,
          visibleOnly,
          frameScope,
          frameCount: perFrameCounts.length,
          matchCount,
          requestedIndex,
        });
      }
      pickedIndex = requestedIndex;
    } else if (!visibleOnly) {
      pickedIndex = 0;
    } else {
      let found: number | null = null;
      let offset = 0;
      for (const entry of perFrameCounts) {
        if (typeof entry.firstVisibleIndex === "number") {
          found = offset + entry.firstVisibleIndex;
          break;
        }
        offset += entry.rawCount;
      }
      if (found === null) {
        throw queryMismatchError({
          message: "No visible element matched click query",
          reason: "no_visible_match",
          queryMode,
          query,
          visibleOnly,
          frameScope,
          frameCount: perFrameCounts.length,
          matchCount,
          requestedIndex,
        });
      }
      pickedIndex = found;
    }
    const urlBeforeClick = target.page.url();
    const deltaBefore = includeDelta ? await captureClickDeltaState(target.page, mainEvaluator, opts.timeoutMs) : null;
    const clickedAriaBefore = includeDelta ? await readAriaAt(pickedIndex) : null;
    const clickedPreview = await clickAt(pickedIndex);
    await target.page
      .waitForLoadState("domcontentloaded", {
        timeout: Math.max(200, Math.min(1000, opts.timeoutMs)),
      })
      .catch(() => {
        // Not all clicks trigger navigation; this is best-effort only.
      });
    const waited: NonNullable<TargetClickReport["wait"]> | null = await waitAfterClickWithBudget({
      waitAfter,
      waitTimeoutMs,
      page: target.page,
      cdp,
      frameTree,
      worldCache,
      queryMode,
      query,
      visibleOnly,
      frameScope,
    });
    const postSnapshot = includeSnapshot ? await readPostSnapshot(mainEvaluator) : null;
    const assertions = await evaluateActionAssertions({
      page: target.page,
      assertions: parsedAssertions,
    });
    const deltaAfter = includeDelta ? await captureClickDeltaState(target.page, mainEvaluator, opts.timeoutMs) : null;
    const clickedAriaAfter = includeDelta ? await readAriaAt(pickedIndex) : null;
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
    if (includeDelta && deltaBefore && deltaAfter && clickedAriaBefore && clickedAriaAfter) {
      delta = buildClickDeltaEvidence({
        before: deltaBefore,
        after: deltaAfter,
        clickedAriaBefore,
        clickedAriaAfter,
      });
    }
    const countAfter = await readSelectorCountAfter({
      enabled: includeProof,
      cdp,
      worldCache,
      queryMode,
      frameScope,
      query,
      selector,
      contains,
    });
    const urlAfterClick = target.page.url();
    const { proof, proofEnvelope } = buildClickProofArtifacts({
      includeProof,
      requestedTargetId,
      urlBeforeClick,
      urlAfterClick,
      openedTargetId,
      openedPageDetected: openedPage !== null,
      matchCount,
      pickedIndex,
      waitAfter,
      waitTimeoutMs,
      waited,
      assertions,
      countAfter,
      postSnapshot,
      delta,
      clickedText: clickedPreview.text,
      clickedSelectorHint: clickedPreview.selectorHint,
    });
    const report: TargetClickReport = buildClickReport({
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      actionId: newActionId(),
      mode: queryMode,
      selector,
      contains,
      visibleOnly,
      query,
      matchCount,
      pickedIndex,
      clicked: {
        index: pickedIndex,
        text: clickedPreview.text,
        visible: clickedPreview.visible,
        selectorHint: clickedPreview.selectorHint,
      },
      url: urlAfterClick,
      title: await safePageTitle(target.page, opts.timeoutMs),
      wait: waited,
      snapshot: postSnapshot,
      proof,
      proofEnvelope,
      assertions,
      delta,
      handoff: {
        sameTarget: openedPage === null,
        openedTargetId,
        openedUrl,
        openedTitle,
      },
      resolvedSessionMs: resolvedSessionAt - startedAt,
      connectCdpMs: connectedAt - resolvedSessionAt,
      actionMs: actionCompletedAt - connectedAt,
    });
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
