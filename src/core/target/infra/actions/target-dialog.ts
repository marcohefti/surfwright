import { chromium } from "playwright-core";
import { CliError } from "../../../errors.js";
import { nowIso, saveTargetSnapshot } from "../../../state/index.js";
import { resolveTargetQueryLocator } from "../target-query.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";
import { parseOptionalTargetQuery, resolveFirstQueryMatch } from "./target-input-query.js";
import { parseWaitAfterClick, resolveWaitTimeoutMs, waitAfterClick } from "../../click/click-utils.js";
import { evaluateActionAssertions, parseActionAssertions } from "../../../shared/index.js";
import { buildActionProofEnvelope, toActionWaitEvidence } from "../../../shared/index.js";
import { connectSessionBrowser } from "../../../session/infra/runtime-access.js";

type TargetDialogReport = {
  ok: true;
  sessionId: string;
  sessionSource?: "explicit" | "target-inferred" | "implicit-new";
  targetId: string;
  handled: boolean;
  dialog: {
    type: string;
    message: string;
    action: "accept" | "dismiss";
  };
  proof?: {
    action: "dialog";
    urlChanged: boolean;
    waitSatisfied: boolean;
    finalUrl: string;
    finalTitle: string;
    queryMode: "text" | "selector" | "none";
    query: string | null;
    selector: string | null;
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

function parseDialogAction(value: string | undefined): "accept" | "dismiss" {
  const action = typeof value === "string" ? value.trim().toLowerCase() : "accept";
  if (action === "accept" || action === "dismiss") {
    return action;
  }
  throw new CliError("E_QUERY_INVALID", "dialog action must be one of: accept, dismiss");
}

export async function targetDialog(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  action?: string;
  promptText?: string;
  triggerText?: string;
  triggerSelector?: string;
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
}): Promise<TargetDialogReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const action = parseDialogAction(opts.action);
  const triggerQuery = parseOptionalTargetQuery({
    textQuery: opts.triggerText,
    selectorQuery: opts.triggerSelector,
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
    const urlBeforeDialog = target.page.url();
    const dialogPromise = target.page.waitForEvent("dialog", {
      timeout: opts.timeoutMs,
    });
    const handledDialogPromise = dialogPromise.then(async (dialog) => {
      const dialogType = dialog.type();
      const dialogMessage = dialog.message();
      if (action === "accept") {
        await dialog.accept(typeof opts.promptText === "string" ? opts.promptText : undefined);
      } else {
        await dialog.dismiss();
      }
      return {
        type: dialogType,
        message: dialogMessage,
      };
    });

    if (triggerQuery) {
      const { locator, count } = await resolveTargetQueryLocator({
        page: target.page,
        parsed: triggerQuery,
        preferExactText: triggerQuery.mode === "text",
      });
      const selected = await resolveFirstQueryMatch({
        locator,
        count,
        visibleOnly: triggerQuery.visibleOnly,
      });
      await selected.click({
        timeout: opts.timeoutMs,
      });
    }
    let handledDialog: {
      type: string;
      message: string;
    };
    try {
      handledDialog = await handledDialogPromise;
    } catch {
      throw new CliError("E_WAIT_TIMEOUT", "dialog did not appear before timeout");
    }
    const actionCompletedAt = Date.now();
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
    const proofEnvelope = includeProof
      ? buildActionProofEnvelope({
          action: "dialog",
          urlBefore: urlBeforeDialog,
          urlAfter: finalUrl,
          targetBefore: requestedTargetId,
          targetAfter: requestedTargetId,
          matchCount: triggerQuery ? null : 0,
          pickedIndex: null,
          wait: toActionWaitEvidence({
            requested: waitAfter ? { ...waitAfter, timeoutMs: waitTimeoutMs } : null,
            observed: waited,
          }),
          assertions,
          countAfter: null,
          details: {
            dialogType: handledDialog.type,
            action,
            finalTitle,
          },
        })
      : null;

    const report: TargetDialogReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      handled: true,
      dialog: {
        type: handledDialog.type,
        message: handledDialog.message,
        action,
      },
      wait: waited,
      ...(assertions ? { assertions } : {}),
      ...(includeProof
        ? {
            proof: {
              action: "dialog",
              urlChanged: urlBeforeDialog !== finalUrl,
              waitSatisfied: waited ? waited.satisfied : true,
              finalUrl,
              finalTitle,
              queryMode: triggerQuery ? triggerQuery.mode : "none",
              query: triggerQuery ? triggerQuery.query : null,
              selector: triggerQuery?.selector ?? null,
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
        lastActionAt: nowIso(),
        lastActionKind: "dialog",
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
