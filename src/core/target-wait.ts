import { chromium } from "playwright-core";
import { CliError } from "./errors.js";
import { nowIso, upsertTargetState } from "./state.js";
import { ensureValidSelector, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "./targets.js";
import type { TargetWaitReport } from "./types.js";

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
  forText?: string;
  forSelector?: string;
  networkIdle?: boolean;
}): Promise<TargetWaitReport> {
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseWaitInput({
    forText: opts.forText,
    forSelector: opts.forSelector,
    networkIdle: opts.networkIdle,
  });

  const { session } = await resolveSessionForAction(opts.sessionId, opts.timeoutMs);
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);

    if (parsed.mode === "text") {
      await target.page.getByText(parsed.value ?? "", { exact: false }).first().waitFor({
        state: "visible",
        timeout: opts.timeoutMs,
      });
    } else if (parsed.mode === "selector") {
      const selectorQuery = parsed.value ?? "";
      await ensureValidSelector(target.page, selectorQuery);
      await target.page.locator(selectorQuery).first().waitFor({
        state: "visible",
        timeout: opts.timeoutMs,
      });
    } else {
      await target.page.waitForLoadState("networkidle", {
        timeout: opts.timeoutMs,
      });
    }

    const report: TargetWaitReport = {
      ok: true,
      sessionId: session.sessionId,
      targetId: requestedTargetId,
      url: target.page.url(),
      title: await target.page.title(),
      mode: parsed.mode,
      value: parsed.value,
    };

    await upsertTargetState({
      targetId: report.targetId,
      sessionId: report.sessionId,
      url: report.url,
      title: report.title,
      status: null,
      updatedAt: nowIso(),
    });

    return report;
  } finally {
    await browser.close();
  }
}
