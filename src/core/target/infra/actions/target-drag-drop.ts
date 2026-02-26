import { chromium } from "playwright-core";
import { newActionId } from "../../../action-id.js";
import { CliError } from "../../../errors.js";
import { nowIso, saveTargetSnapshot } from "../../../state/index.js";
import { ensureValidSelector, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";
import { parseWaitAfterClick, resolveWaitTimeoutMs, waitAfterClick } from "../../click/click-utils.js";
import { evaluateActionAssertions, parseActionAssertions } from "../../../shared/index.js";
import { buildActionProofEnvelope, toActionWaitEvidence } from "../../../shared/index.js";
import { connectSessionBrowser } from "../../../session/infra/runtime-access.js";

type TargetDragDropReport = {
  ok: true;
  sessionId: string;
  sessionSource?: "explicit" | "target-inferred" | "implicit-new";
  targetId: string;
  actionId: string;
  from: string;
  to: string;
  result: "dragged";
  proof?: {
    action: "drag-drop";
    urlChanged: boolean;
    waitSatisfied: boolean;
    finalUrl: string;
    finalTitle: string;
    queryMode: "selector";
    query: string;
    selector: string;
    countAfter: null;
  };
  proofEnvelope?: import("../../../types.js").ActionProofEnvelope;
  assertions?: import("../../../types.js").ActionAssertionReport | null;
  wait?: {
    mode: "text" | "selector" | "network-idle";
    value: string | null;
    timeoutMs: number;
    elapsedMs: number;
    satisfied: boolean;
  } | null;
  timingMs: {
    total: number;
    resolveSession: number;
    connectCdp: number;
    action: number;
    persistState: number;
  };
};

function parseRequiredSelector(input: string | undefined, optionName: string): string {
  const selector = typeof input === "string" ? input.trim() : "";
  if (selector.length === 0) {
    throw new CliError("E_QUERY_INVALID", `${optionName} selector is required`);
  }
  return selector;
}

export async function targetDragDrop(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  fromSelector?: string;
  toSelector?: string;
  waitForText?: string;
  waitForSelector?: string;
  waitNetworkIdle?: boolean;
  waitTimeoutMs?: number;
  proof?: boolean;
  assertUrlPrefix?: string;
  assertSelector?: string;
  assertText?: string;
}): Promise<TargetDragDropReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const fromSelector = parseRequiredSelector(opts.fromSelector, "from");
  const toSelector = parseRequiredSelector(opts.toSelector, "to");
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
    await ensureValidSelector(target.page, fromSelector);
    await ensureValidSelector(target.page, toSelector);

    const fromCount = await target.page.locator(fromSelector).count();
    if (fromCount < 1) {
      throw new CliError("E_QUERY_INVALID", `No element matched source selector: ${fromSelector}`);
    }
    const toCount = await target.page.locator(toSelector).count();
    if (toCount < 1) {
      throw new CliError("E_QUERY_INVALID", `No element matched destination selector: ${toSelector}`);
    }

    const urlBeforeAction = target.page.url();
    await target.page.dragAndDrop(fromSelector, toSelector, {
      timeout: opts.timeoutMs,
    });
    const waitStartedAt = Date.now();
    const waitedMode = await waitAfterClick({
      page: target.page,
      waitAfter,
      timeoutMs: waitTimeoutMs,
    });
    const waited =
      waitedMode === null
        ? null
        : {
            mode: waitedMode.mode,
            value: waitedMode.value,
            timeoutMs: waitTimeoutMs,
            elapsedMs: Date.now() - waitStartedAt,
            satisfied: true,
          };
    const finalUrl = target.page.url();
    const assertions = await evaluateActionAssertions({
      page: target.page,
      assertions: parsedAssertions,
    });
    const finalTitle = await target.page.title();
    const actionCompletedAt = Date.now();
    const proofEnvelope = includeProof
      ? buildActionProofEnvelope({
          action: "drag-drop",
          urlBefore: urlBeforeAction,
          urlAfter: finalUrl,
          targetBefore: requestedTargetId,
          targetAfter: requestedTargetId,
          matchCount: 1,
          pickedIndex: 0,
          wait: toActionWaitEvidence({
            requested: waitAfter ? { ...waitAfter, timeoutMs: waitTimeoutMs } : null,
            observed: waited,
          }),
          assertions,
          countAfter: null,
          details: {
            from: fromSelector,
            to: toSelector,
            finalTitle,
          },
        })
      : null;

    const report: TargetDragDropReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      actionId: newActionId(),
      from: fromSelector,
      to: toSelector,
      result: "dragged",
      wait: waited,
      ...(assertions ? { assertions } : {}),
      ...(includeProof
        ? {
            proof: {
              action: "drag-drop",
              urlChanged: urlBeforeAction !== finalUrl,
              waitSatisfied: waited ? waited.satisfied : true,
              finalUrl,
              finalTitle,
              queryMode: "selector",
              query: `${fromSelector} -> ${toSelector}`,
              selector: fromSelector,
              countAfter: null,
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
        lastActionKind: "drag-drop",
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
