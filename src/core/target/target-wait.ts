import { chromium, type Locator } from "playwright-core";
import { newActionId } from "../action-id.js";
import { CliError } from "../errors.js";
import { nowIso } from "../state.js";
import { saveTargetSnapshot } from "../state/index.js";
import { parseTargetQueryInput, resolveTargetQueryLocator } from "./target-query.js";
import { ensureValidSelector, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "./targets.js";
import type { TargetWaitReport } from "../types.js";

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

type TargetDialogReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  dialog: {
    type: string;
    message: string;
    action: "accept" | "dismiss";
  };
  timingMs: {
    total: number;
    resolveSession: number;
    connectCdp: number;
    action: number;
    persistState: number;
  };
};

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

function parseKeyInput(value: string | undefined): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (key.length === 0) {
    throw new CliError("E_QUERY_INVALID", "key is required");
  }
  return key;
}

function parseDialogAction(value: string | undefined): "accept" | "dismiss" {
  const action = typeof value === "string" ? value.trim().toLowerCase() : "accept";
  if (action === "accept" || action === "dismiss") {
    return action;
  }
  throw new CliError("E_QUERY_INVALID", "dialog action must be one of: accept, dismiss");
}

function parseOptionalKeypressQuery(opts: {
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
}): ReturnType<typeof parseTargetQueryInput> | null {
  const selectedCount =
    Number(typeof opts.textQuery === "string" && opts.textQuery.trim().length > 0) +
    Number(typeof opts.selectorQuery === "string" && opts.selectorQuery.trim().length > 0) +
    Number(typeof opts.containsQuery === "string" && opts.containsQuery.trim().length > 0);
  if (selectedCount === 0) {
    return null;
  }
  return parseTargetQueryInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    containsQuery: opts.containsQuery,
    visibleOnly: opts.visibleOnly,
  });
}

async function resolveFirstQueryMatch(opts: {
  locator: Locator;
  count: number;
  visibleOnly: boolean;
}): Promise<Locator> {
  for (let idx = 0; idx < opts.count; idx += 1) {
    const candidate = opts.locator.nth(idx);
    let visible = false;
    try {
      visible = await candidate.isVisible();
    } catch {
      visible = false;
    }

    if (opts.visibleOnly && !visible) {
      continue;
    }
    return candidate;
  }
  throw new CliError(
    "E_QUERY_INVALID",
    opts.visibleOnly ? "No visible element matched keypress query" : "No element matched keypress query",
  );
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
        if (error instanceof Error && /timeout/i.test(error.message)) {
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
        if (error instanceof Error && /timeout/i.test(error.message)) {
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
        if (error instanceof Error && /timeout/i.test(error.message)) {
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
  const parsedQuery = parseOptionalKeypressQuery({
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
    const resultText = await target.page.evaluate(() => {
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
}): Promise<TargetDialogReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const action = parseDialogAction(opts.action);
  const triggerQuery = parseOptionalKeypressQuery({
    textQuery: opts.triggerText,
    selectorQuery: opts.triggerSelector,
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

    const report: TargetDialogReport = {
      ok: true,
      sessionId: session.sessionId,
      targetId: requestedTargetId,
      dialog: {
        type: handledDialog.type,
        message: handledDialog.message,
        action,
      },
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
