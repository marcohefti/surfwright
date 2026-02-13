import { chromium } from "playwright-core";
import { CliError } from "../errors.js";
import { nowIso } from "../state.js";
import { saveTargetSnapshot } from "../state-repos/target-repo.js";
import { ensureValidSelector, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "./targets.js";
import type { TargetWaitReport } from "../types.js";

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
  sessionId?: string;
  persistState?: boolean;
  forText?: string;
  forSelector?: string;
  networkIdle?: boolean;
}): Promise<TargetWaitReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseWaitInput({
    forText: opts.forText,
    forSelector: opts.forSelector,
    networkIdle: opts.networkIdle,
  });

  const { session, sessionSource } = await resolveSessionForAction({
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
    const throwWaitTimeout = (): never => {
      throw new CliError("E_WAIT_TIMEOUT", "wait condition did not complete before timeout");
    };

    if (parsed.mode === "text") {
      try {
        await target.page.getByText(parsed.value ?? "", { exact: false }).first().waitFor({
          state: "visible",
          timeout: opts.timeoutMs,
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Timeout")) {
          throwWaitTimeout();
        }
        throw error;
      }
    } else if (parsed.mode === "selector") {
      const selectorQuery = parsed.value ?? "";
      await ensureValidSelector(target.page, selectorQuery);
      try {
        await target.page.locator(selectorQuery).first().waitFor({
          state: "visible",
          timeout: opts.timeoutMs,
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Timeout")) {
          throwWaitTimeout();
        }
        throw error;
      }
    } else {
      try {
        await target.page.waitForLoadState("networkidle", {
          timeout: opts.timeoutMs,
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Timeout")) {
          throwWaitTimeout();
        }
        throw error;
      }
    }
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
