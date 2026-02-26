import { chromium } from "playwright-core";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "./targets.js";
import { parseFrameScope } from "./target-find.js";
import { createCdpEvaluator, ensureValidSelectorSyntaxCdp, frameIdsForScope, getCdpFrameTree, openCdpSession } from "./cdp/index.js";
import type { TargetWaitReport } from "../../types.js";
import { evaluateActionAssertions, parseActionAssertions } from "../../shared/index.js";
import type { BrowserRuntimeLike } from "./types/browser-dom-types.js";
import { connectSessionBrowser } from "../../session/infra/runtime-access.js";

function parseWaitInput(opts: {
  forText?: string;
  forSelector?: string;
  networkIdle?: boolean;
}): {
  mode: TargetWaitReport["mode"];
  value: string | null;
} {
  const forText = typeof opts.forText === "string" ? opts.forText.trim() : "";
  const forSelector = typeof opts.forSelector === "string" ? opts.forSelector.trim() : "";
  const networkIdle = Boolean(opts.networkIdle);
  const hasText = forText.length > 0;
  const hasSelector = forSelector.length > 0;
  const selectedCount = Number(hasText) + Number(hasSelector) + Number(networkIdle);
  if (selectedCount !== 1) {
    throw new CliError(
      "E_QUERY_INVALID",
      "Provide exactly one wait mode: --for-text <text>, --for-selector <selector>, or --network-idle",
    );
  }

  if (hasText) {
    return {
      mode: "text",
      value: forText,
    };
  }
  if (hasSelector) {
    return {
      mode: "selector",
      value: forSelector,
    };
  }
  return {
    mode: "network-idle",
    value: null,
  };
}

export async function targetWait(opts: {
  targetId: string;
  timeoutMs: number;
  waitTimeoutMs?: number;
  sessionId?: string;
  persistState?: boolean;
  forText?: string;
  forSelector?: string;
  networkIdle?: boolean;
  frameScope?: string;
  assertUrlPrefix?: string;
  assertSelector?: string;
  assertText?: string;
}): Promise<TargetWaitReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseWaitInput({
    forText: opts.forText,
    forSelector: opts.forSelector,
    networkIdle: opts.networkIdle,
  });
  const frameScope = parseFrameScope(opts.frameScope);
  const parsedAssertions = parseActionAssertions({
    assertUrlPrefix: opts.assertUrlPrefix,
    assertSelector: opts.assertSelector,
    assertText: opts.assertText,
  });
  const waitTimeoutMs =
    typeof opts.waitTimeoutMs === "number"
      ? opts.waitTimeoutMs
      : opts.timeoutMs;
  if (!Number.isFinite(waitTimeoutMs) || !Number.isInteger(waitTimeoutMs) || waitTimeoutMs <= 0) {
    throw new CliError("E_QUERY_INVALID", "wait-timeout-ms must be a positive integer");
  }

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
    const throwWaitTimeout = (): never => {
      throw new CliError("E_WAIT_TIMEOUT", "wait condition did not complete before timeout");
    };

    const waitStartedAt = Date.now();
    if (parsed.mode === "text") {
      const cdp = await openCdpSession(target.page);
      const frameTree = await getCdpFrameTree(cdp);
      const frameIds = frameIdsForScope({ frameTree, scope: frameScope });
      const worldCache = new Map<string, number>();
      const needle = parsed.value ?? "";
      const started = Date.now();
      while (Date.now() - started < waitTimeoutMs) {
        let matched = false;
        for (const frameCdpId of frameIds) {
          const evaluator = createCdpEvaluator({ cdp, frameCdpId, worldCache });
          const ok = await evaluator.evaluate(({ text }: { text: string }) => {
            const runtime = globalThis as unknown as BrowserRuntimeLike;
            const body = runtime.document?.body ?? null;
            const normalize = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();
            const hay = normalize(String(body?.innerText ?? ""));
            const needle = normalize(text);
            return needle.length > 0 && hay.includes(needle);
          }, { text: needle });
          if (ok) {
            matched = true;
            break;
          }
        }
        if (matched) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (Date.now() - started >= waitTimeoutMs) {
        throwWaitTimeout();
      }
    } else if (parsed.mode === "selector") {
      const selectorQuery = parsed.value ?? "";
      const cdp = await openCdpSession(target.page);
      const frameTree = await getCdpFrameTree(cdp);
      const frameIds = frameIdsForScope({ frameTree, scope: frameScope });
      const worldCache = new Map<string, number>();
      await ensureValidSelectorSyntaxCdp({
        cdp,
        frameCdpId: frameTree.frame.id,
        worldCache,
        selectorQuery,
      });
      const started = Date.now();
      while (Date.now() - started < waitTimeoutMs) {
        let matched = false;
        for (const frameCdpId of frameIds) {
          const evaluator = createCdpEvaluator({ cdp, frameCdpId, worldCache });
          const ok = await evaluator.evaluate(({ selector }: { selector: string }) => {
            const runtime = globalThis as unknown as BrowserRuntimeLike;
            const doc = runtime.document;
            const node = doc?.querySelector?.(selector) ?? null;
            if (!node) return false;
            if (node.hasAttribute?.("hidden")) return false;
            const style = runtime.getComputedStyle?.(node);
            if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return false;
            return (node.getClientRects?.().length ?? 0) > 0;
          }, { selector: selectorQuery });
          if (ok) {
            matched = true;
            break;
          }
        }
        if (matched) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (Date.now() - started >= waitTimeoutMs) {
        throwWaitTimeout();
      }
    } else {
      try {
        await target.page.waitForLoadState("networkidle", {
          timeout: waitTimeoutMs,
        });
      } catch (error) {
        if (error instanceof Error && /timeout/i.test(error.message)) {
          throwWaitTimeout();
        }
        throw error;
      }
    }
    const waitElapsedMs = Date.now() - waitStartedAt;
    const assertions = await evaluateActionAssertions({
      page: target.page,
      assertions: parsedAssertions,
    });
    const actionCompletedAt = Date.now();

    const report: TargetWaitReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      url: target.page.url(),
      title: await target.page.title(),
      mode: parsed.mode,
      value: parsed.value,
      wait: {
        mode: parsed.mode,
        value: parsed.value,
        timeoutMs: waitTimeoutMs,
        elapsedMs: waitElapsedMs,
        satisfied: true,
      },
      ...(assertions ? { assertions } : {}),
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
