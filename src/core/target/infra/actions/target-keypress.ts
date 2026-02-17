import { chromium } from "playwright-core";
import { newActionId } from "../../../action-id.js";
import { CliError } from "../../../errors.js";
import { nowIso, saveTargetSnapshot } from "../../../state/index.js";
import { createCdpEvaluator, getCdpFrameTree, openCdpSession } from "../cdp/index.js";
import { resolveTargetQueryLocator } from "../target-query.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";
import { parseOptionalTargetQuery, resolveFirstQueryMatch } from "./target-input-query.js";

type TargetKeypressReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  actionId: string;
  key: string;
  selector: string | null;
  resultText: string;
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

  const { session } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: requestedTargetId,
  });
  const resolvedSessionAt = Date.now();
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);

    if (parsedQuery) {
      const { locator, count } = await resolveTargetQueryLocator({
        page: target.page,
        parsed: parsedQuery,
        preferExactText: parsedQuery.mode === "text",
      });
      const selected = await resolveFirstQueryMatch({
        locator,
        count,
        visibleOnly: parsedQuery.visibleOnly,
      });
      await selected.focus({
        timeout: opts.timeoutMs,
      });
    } else {
      await target.page.focus("body").catch(() => {
        // Fallback path for pages with no focusable body.
      });
    }

    await target.page.keyboard.press(key);
    const cdp = await openCdpSession(target.page);
    const frameTree = await getCdpFrameTree(cdp);
    const worldCache = new Map<string, number>();
    const evaluator = createCdpEvaluator({
      cdp,
      frameCdpId: frameTree.frame.id,
      worldCache,
    });
    const resultText = await evaluator.evaluate(() => {
      const runtime = globalThis as unknown as { document?: any };
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
    const actionCompletedAt = Date.now();

    const report: TargetKeypressReport = {
      ok: true,
      sessionId: session.sessionId,
      targetId: requestedTargetId,
      actionId: newActionId(),
      key,
      selector: parsedQuery?.selector ?? null,
      resultText,
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

