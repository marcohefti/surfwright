import { chromium } from "playwright-core";
import { newActionId } from "../../../action-id.js";
import { CliError } from "../../../errors.js";
import { nowIso, saveTargetSnapshot } from "../../../state/index.js";
import { createCdpEvaluator, getCdpFrameTree, openCdpSession } from "../cdp/index.js";
import { resolveTargetQueryLocator } from "../target-query.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";
import { parseOptionalTargetQuery, resolveFirstQueryMatch } from "./target-input-query.js";
import { parseWaitAfterClick, resolveWaitTimeoutMs } from "../../click/click-utils.js";
import { waitAfterClickWithBudget } from "../../click/click-wait.js";
import { readSelectorCountAfter } from "../../click/click-proof.js";
import { evaluateActionAssertions, parseActionAssertions } from "../../../shared/index.js";
import { buildActionProofEnvelope, toActionWaitEvidence } from "../../../shared/index.js";
import type { BrowserRuntimeLike } from "../types/browser-dom-types.js";
import { connectSessionBrowser } from "../../../session/infra/runtime-access.js";

type TargetKeypressReport = {
  ok: true;
  sessionId: string;
  sessionSource?: "explicit" | "target-inferred" | "implicit-new";
  targetId: string;
  actionId: string;
  key: string;
  selector: string | null;
  queryMode?: "text" | "selector" | "none";
  query?: string | null;
  matchCount?: number | null;
  pickedIndex?: number | null;
  resultText: string;
  wait?: {
    mode: "text" | "selector" | "network-idle";
    value: string | null;
    timeoutMs: number;
    elapsedMs: number;
    satisfied: boolean;
  } | null;
  assertions?: import("../../../types.js").ActionAssertionReport | null;
  proof?: {
    action: "keypress";
    urlChanged: boolean;
    waitSatisfied: boolean;
    finalUrl: string;
    finalTitle: string;
    queryMode: "text" | "selector" | "none";
    query: string | null;
    selector: string | null;
    countAfter: number | null;
  };
  proofEnvelope?: import("../../../types.js").ActionProofEnvelope;
  timingMs: {
    total: number;
    resolveSession: number;
    connectCdp: number;
    action: number;
    persistState: number;
  };
};

function parseKeyInput(value: string | undefined): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (key.length === 0) {
    throw new CliError("E_QUERY_INVALID", "key is required");
  }
  return key;
}

export async function targetKeypress(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  key?: string;
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
  waitForText?: string;
  waitForSelector?: string;
  waitNetworkIdle?: boolean;
  waitTimeoutMs?: number;
  proof?: boolean;
  assertUrlPrefix?: string;
  assertSelector?: string;
  assertText?: string;
}): Promise<TargetKeypressReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const key = parseKeyInput(opts.key);
  const parsedQuery = parseOptionalTargetQuery({
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
  const waitTimeoutMs = resolveWaitTimeoutMs(opts.waitTimeoutMs, opts.timeoutMs);
  const includeProof = Boolean(opts.proof);
  const parsedAssertions = parseActionAssertions({
    assertUrlPrefix: opts.assertUrlPrefix,
    assertSelector: opts.assertSelector,
    assertText: opts.assertText,
  });

  const { session, sessionSource } = await resolveSessionForAction({
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
    const target = await resolveTargetHandle(browser, requestedTargetId);

    let matchCount: number | null = null;
    let pickedIndex: number | null = null;
    if (parsedQuery) {
      const { locator, count } = await resolveTargetQueryLocator({
        page: target.page,
        parsed: parsedQuery,
        preferExactText: parsedQuery.mode === "text",
      });
      matchCount = count;
      const selected = await resolveFirstQueryMatch({
        locator,
        count,
        visibleOnly: parsedQuery.visibleOnly,
      });
      for (let idx = 0; idx < count; idx += 1) {
        if (await locator.nth(idx).isVisible().catch(() => false) || !parsedQuery.visibleOnly) {
          pickedIndex = idx;
          if (!parsedQuery.visibleOnly) {
            break;
          }
          if (pickedIndex !== null) {
            break;
          }
        }
      }
      await selected.focus({
        timeout: opts.timeoutMs,
      });
    } else {
      await target.page.focus("body").catch(() => {
        // Fallback path for pages with no focusable body.
      });
    }

    const urlBeforeKeypress = target.page.url();
    await target.page.keyboard.press(key);
    const cdp = await openCdpSession(target.page);
    const frameTree = await getCdpFrameTree(cdp);
    const worldCache = new Map<string, number>();
    const waited = await waitAfterClickWithBudget({
      waitAfter,
      waitTimeoutMs,
      page: target.page,
      cdp,
      frameTree,
      worldCache,
      queryMode: parsedQuery?.mode ?? "handle",
      query: parsedQuery?.query ?? "<page>",
      visibleOnly: Boolean(parsedQuery?.visibleOnly),
      frameScope: "main",
    });
    const evaluator = createCdpEvaluator({
      cdp,
      frameCdpId: frameTree.frame.id,
      worldCache,
    });
    const resultText = await evaluator.evaluate(() => {
      const runtime = globalThis as unknown as BrowserRuntimeLike;
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const active = runtime.document?.activeElement as
        | null
        | {
            value?: string;
            innerText?: string;
            textContent?: string;
          };
      const raw =
        typeof active?.value === "string"
          ? active.value
          : typeof active?.innerText === "string"
            ? active.innerText
            : typeof active?.textContent === "string"
              ? active.textContent
              : "";
      return normalize(raw).slice(0, 240);
    });
    const countAfter = await readSelectorCountAfter({
      enabled: includeProof && parsedQuery?.mode === "selector",
      cdp,
      worldCache,
      queryMode: parsedQuery?.mode === "selector" ? "selector" : "text",
      frameScope: "main",
      query: parsedQuery?.query ?? "",
      selector: parsedQuery?.selector ?? null,
      contains: parsedQuery?.contains ?? null,
    });
    const finalUrl = target.page.url();
    const assertions = await evaluateActionAssertions({
      page: target.page,
      assertions: parsedAssertions,
    });
    const finalTitle = await target.page.title();
    const actionCompletedAt = Date.now();
    const proofEnvelope = includeProof
      ? buildActionProofEnvelope({
          action: "keypress",
          urlBefore: urlBeforeKeypress,
          urlAfter: finalUrl,
          targetBefore: requestedTargetId,
          targetAfter: requestedTargetId,
          matchCount,
          pickedIndex,
          wait: toActionWaitEvidence({
            requested: waitAfter ? { ...waitAfter, timeoutMs: waitTimeoutMs } : null,
            observed: waited,
          }),
          assertions,
          countAfter,
          details: {
            key,
            queryMode: parsedQuery ? parsedQuery.mode : "none",
            query: parsedQuery?.query ?? null,
            selector: parsedQuery?.selector ?? null,
            finalTitle,
          },
        })
      : null;

    const report: TargetKeypressReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      actionId: newActionId(),
      key,
      selector: parsedQuery?.selector ?? null,
      queryMode: parsedQuery ? parsedQuery.mode : "none",
      query: parsedQuery?.query ?? null,
      matchCount,
      pickedIndex,
      resultText,
      wait: waited,
      ...(assertions ? { assertions } : {}),
      ...(includeProof
        ? {
            proof: {
              action: "keypress",
              urlChanged: urlBeforeKeypress !== finalUrl,
              waitSatisfied: waited ? waited.satisfied : true,
              finalUrl,
              finalTitle,
              queryMode: parsedQuery ? parsedQuery.mode : "none",
              query: parsedQuery?.query ?? null,
              selector: parsedQuery?.selector ?? null,
              countAfter,
            },
            ...(proofEnvelope ? { proofEnvelope } : {}),
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
        url: target.page.url(),
        title: await target.page.title(),
        status: null,
        lastActionId: report.actionId,
        lastActionAt: nowIso(),
        lastActionKind: "keypress",
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
