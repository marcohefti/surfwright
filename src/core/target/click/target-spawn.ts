import { chromium } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { parseTargetQueryInput } from "../infra/target-query.js";
import { parseFrameScope } from "../infra/target-find.js";
import { readPageTargetId, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../infra/targets.js";
import { createCdpEvaluator, ensureValidSelectorSyntaxCdp, frameIdsForScope, getCdpFrameTree, openCdpSession } from "../infra/cdp/index.js";
import { cdpQueryOp } from "./cdp-query-op.js";
import { connectSessionBrowser } from "../../session/infra/runtime-access.js";

type TargetSpawnReport = {
  ok: true;
  sessionId: string;
  parentTargetId: string;
  targetId: string;
  actionId: string;
  query: string;
  url: string;
  title: string;
  proof?: {
    action: "spawn";
    parentTargetId: string;
    targetId: string;
    title: string;
    titleMatched: boolean;
    finalUrl: string;
  };
  timingMs: {
    total: number;
    resolveSession: number;
    connectCdp: number;
    action: number;
    persistState: number;
  };
};

export async function targetSpawn(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
  frameScope?: string;
  proof?: boolean;
  assertTitle?: string;
}): Promise<TargetSpawnReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseTargetQueryInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    containsQuery: opts.containsQuery,
    visibleOnly: opts.visibleOnly,
  });
  const frameScope = parseFrameScope(opts.frameScope);
  const includeProof = Boolean(opts.proof);
  const assertTitle = typeof opts.assertTitle === "string" ? opts.assertTitle.trim() : "";

  const { session } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: requestedTargetId,
  });
  const resolvedSessionAt = Date.now();
  const browser = await connectSessionBrowser(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();

  try {
    const parent = await resolveTargetHandle(browser, requestedTargetId);
    const context = parent.page.context();
    const beforePages = context.pages();

    const cdp = await openCdpSession(parent.page);
    const frameTree = await getCdpFrameTree(cdp);
    const worldCache = new Map<string, number>();
    const frameIds = frameIdsForScope({ frameTree, scope: frameScope });

    if (parsed.mode === "selector" && typeof parsed.selector === "string") {
      await ensureValidSelectorSyntaxCdp({
        cdp,
        frameCdpId: frameTree.frame.id,
        worldCache,
        selectorQuery: parsed.selector,
      });
    }

    const perFrameCounts: Array<{ frameCdpId: string; rawCount: number; firstVisibleIndex: number | null }> = [];
    for (const frameCdpId of frameIds) {
      const evaluator = createCdpEvaluator({ cdp, frameCdpId, worldCache });
      const summary = (await evaluator.evaluate(cdpQueryOp, {
        op: "summary",
        mode: parsed.mode,
        query: parsed.query,
        selector: parsed.selector,
        contains: parsed.contains,
      })) as { rawCount: number; firstVisibleIndex: number | null };
      perFrameCounts.push({ frameCdpId, rawCount: summary.rawCount, firstVisibleIndex: summary.firstVisibleIndex });
    }

    const matchCount = perFrameCounts.reduce((sum, entry) => sum + entry.rawCount, 0);
    if (matchCount < 1) {
      throw new CliError("E_QUERY_INVALID", parsed.visibleOnly ? "No visible element matched spawn query" : "No element matched spawn query");
    }

    let pickedIndex = 0;
    if (parsed.visibleOnly) {
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
        throw new CliError("E_QUERY_INVALID", "No visible element matched spawn query");
      }
      pickedIndex = found;
    }

    // Resolve pickedIndex -> frame/localIndex.
    let offset = 0;
    let frameCdpId: string | null = null;
    let localIndex = -1;
    for (const entry of perFrameCounts) {
      if (pickedIndex < offset + entry.rawCount) {
        frameCdpId = entry.frameCdpId;
        localIndex = pickedIndex - offset;
        break;
      }
      offset += entry.rawCount;
    }
    if (!frameCdpId || localIndex < 0) {
      throw new CliError("E_INTERNAL", "Unable to resolve spawn target");
    }

    const childPagePromise = context.waitForEvent("page", { timeout: opts.timeoutMs });
    const evaluator = createCdpEvaluator({ cdp, frameCdpId, worldCache });
    const clickPoint = (await evaluator.evaluate(cdpQueryOp, {
      op: "click-point",
      mode: parsed.mode,
      query: parsed.query,
      selector: parsed.selector,
      contains: parsed.contains,
      index: localIndex,
    })) as { ok: boolean; x?: number; y?: number };
    if (!clickPoint.ok || typeof clickPoint.x !== "number" || typeof clickPoint.y !== "number") {
      throw new CliError("E_QUERY_INVALID", parsed.visibleOnly ? "No visible element matched spawn query" : "No element matched spawn query");
    }
    await parent.page.mouse.click(clickPoint.x, clickPoint.y);

    let childPage: (typeof beforePages)[number] | null = null;
    try {
      childPage = await childPagePromise;
    } catch {
      const pagesNow = context.pages();
      childPage = pagesNow.find((page) => !beforePages.includes(page)) ?? null;
      if (!childPage) {
        throw new CliError("E_WAIT_TIMEOUT", "spawn did not produce a new target before timeout");
      }
    }

    await childPage
      .waitForLoadState("domcontentloaded", {
        timeout: Math.max(200, Math.min(1000, opts.timeoutMs)),
      })
      .catch(() => {
        // Not all spawned pages reach domcontentloaded in this window.
      });

    const spawnedTargetId = await readPageTargetId(context, childPage);
    const title = await childPage.title();
    const titleMatched = assertTitle.length < 1 ? true : title.includes(assertTitle);
    if (!titleMatched) {
      throw new CliError("E_ASSERT_FAILED", `spawn assertion failed: title did not include "${assertTitle}"`);
    }
    const actionCompletedAt = Date.now();

    const report: TargetSpawnReport = {
      ok: true,
      sessionId: session.sessionId,
      parentTargetId: requestedTargetId,
      targetId: spawnedTargetId,
      actionId: newActionId(),
      query: parsed.query,
      url: childPage.url(),
      title,
      ...(includeProof
        ? {
            proof: {
              action: "spawn",
              parentTargetId: requestedTargetId,
              targetId: spawnedTargetId,
              title,
              titleMatched,
              finalUrl: childPage.url(),
            },
          }
        : {}),
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
        lastActionKind: "spawn",
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
