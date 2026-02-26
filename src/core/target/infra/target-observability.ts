import { chromium, type Request } from "playwright-core";
import { CliError } from "../../errors.js";
import { readRecentTargetAction } from "../../state/index.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "./targets.js";
import { createCdpEvaluator, getCdpFrameTree, listCdpFrameEntries, openCdpSession } from "./cdp/index.js";
import type { BrowserRuntimeLike } from "./types/browser-dom-types.js";
import type { SessionSource, TargetConsoleTailReport, TargetHealthReport, TargetHudReport } from "../../types.js";
import { connectSessionBrowser } from "../../session/infra/runtime-access.js";

type TargetConsoleGetEvent = {
  type: "console" | "page-error" | "request-failed";
  level: string;
  text: string;
  atMs: number;
  actionId: string | null;
};

type TargetConsoleGetReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  event: TargetConsoleGetEvent | null;
  captureMs: number;
  seen: number;
  timingMs: {
    total: number;
  };
};

const CONSOLE_TAIL_MAX_EVENTS = 500;
const CONSOLE_TAIL_MAX_TEXT = 1200;

function parsePositiveInt(opts: { value: number | undefined; fallback: number; min: number; max: number; name: string }): number {
  const value = typeof opts.value === "number" ? opts.value : opts.fallback;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < opts.min || value > opts.max) {
    throw new CliError("E_QUERY_INVALID", `${opts.name} must be an integer between ${opts.min} and ${opts.max}`);
  }
  return value;
}

function parseConsoleLevels(input: string | undefined): Set<string> {
  if (typeof input !== "string" || input.trim().length === 0) {
    return new Set(["log", "info", "warn", "error", "debug"]);
  }
  return new Set(
    input
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length > 0),
  );
}

function maybeTruncate(text: string): string {
  return text.length <= CONSOLE_TAIL_MAX_TEXT ? text : `${text.slice(0, CONSOLE_TAIL_MAX_TEXT - 1)}…`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toConsoleGetEvent(event: Record<string, unknown>): TargetConsoleGetReport["event"] {
  const type = event.type;
  if (type !== "console" && type !== "page-error" && type !== "request-failed") {
    return null;
  }
  const text = event.text;
  if (typeof text !== "string" || text.trim().length === 0) {
    return null;
  }
  const level = typeof event.level === "string" && event.level.trim().length > 0 ? event.level : "error";
  const atMs = typeof event.atMs === "number" && Number.isFinite(event.atMs) && event.atMs >= 0 ? event.atMs : 0;
  const actionId = typeof event.actionId === "string" ? event.actionId : null;
  return {
    type,
    level,
    text,
    atMs,
    actionId,
  };
}

export async function targetConsoleTail(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  captureMs?: number;
  maxEvents?: number;
  levels?: string;
  reload?: boolean;
  onEvent: (event: Record<string, unknown>) => void;
}): Promise<TargetConsoleTailReport> {
  const targetId = sanitizeTargetId(opts.targetId);
  const captureMs = parsePositiveInt({
    value: opts.captureMs,
    fallback: 2500,
    min: 50,
    max: 120000,
    name: "capture-ms",
  });
  const maxEvents = parsePositiveInt({
    value: opts.maxEvents,
    fallback: 120,
    min: 1,
    max: CONSOLE_TAIL_MAX_EVENTS,
    name: "max-events",
  });
  const levels = parseConsoleLevels(opts.levels);
  const { session, sessionSource } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: targetId,
  });
  const browser = await connectSessionBrowser(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const startedEpochMs = Date.now();

  let emitted = 0;
  let seen = 0;
  const counts = {
    log: 0,
    info: 0,
    warn: 0,
    error: 0,
    debug: 0,
    pageError: 0,
    requestFailed: 0,
  };
  const emit = (event: Record<string, unknown>) => {
    emitted += 1;
    opts.onEvent(event);
  };

  try {
    const target = await resolveTargetHandle(browser, targetId);
    const actionId = readRecentTargetAction({
      targetId,
      sessionId: session.sessionId,
    });
    const onConsole = (message: { type(): string; text(): string }) => {
      seen += 1;
      const level = message.type().toLowerCase();
      if (level in counts) {
        counts[level as keyof typeof counts] += 1;
      }
      if (!levels.has(level) || emitted >= maxEvents) {
        return;
      }
      emit({
        type: "console",
        level,
        text: maybeTruncate(message.text()),
        atMs: Math.max(0, Date.now() - startedEpochMs),
        sessionId: session.sessionId,
        targetId,
        actionId,
      });
    };
    const onPageError = (error: Error) => {
      seen += 1;
      counts.pageError += 1;
      if (!levels.has("error") || emitted >= maxEvents) {
        return;
      }
      emit({
        type: "page-error",
        level: "error",
        text: maybeTruncate(error.message),
        atMs: Math.max(0, Date.now() - startedEpochMs),
        sessionId: session.sessionId,
        targetId,
        actionId,
      });
    };
    const onRequestFailed = (request: Request) => {
      seen += 1;
      counts.requestFailed += 1;
      if (!levels.has("error") || emitted >= maxEvents) {
        return;
      }
      emit({
        type: "request-failed",
        level: "error",
        text: `${request.method()} ${request.url()} ${request.failure()?.errorText ?? "request failed"}`,
        atMs: Math.max(0, Date.now() - startedEpochMs),
        sessionId: session.sessionId,
        targetId,
        actionId,
      });
    };

    target.page.on("console", onConsole as never);
    target.page.on("pageerror", onPageError as never);
    target.page.on("requestfailed", onRequestFailed as never);
    try {
      if (opts.reload) {
        await target.page.reload({
          waitUntil: "domcontentloaded",
          timeout: opts.timeoutMs,
        });
      }
      const deadline = Date.now() + captureMs;
      while (Date.now() < deadline) {
        await sleep(50);
      }
    } finally {
      target.page.off("console", onConsole as never);
      target.page.off("pageerror", onPageError as never);
      target.page.off("requestfailed", onRequestFailed as never);
    }

    const report: TargetConsoleTailReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId,
      actionId,
      captureMs,
      maxEvents,
      seen,
      emitted,
      truncated: seen > emitted,
      counts,
    };
    emit({
      type: "capture",
      phase: "end",
      ...report,
    });
    return report;
  } finally {
    await browser.close();
  }
}

export async function targetConsoleGet(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  captureMs?: number;
  levels?: string;
  contains?: string;
  reload?: boolean;
}): Promise<TargetConsoleGetReport> {
  const startedAt = Date.now();
  const contains = typeof opts.contains === "string" && opts.contains.trim().length > 0 ? opts.contains : null;
  let event: TargetConsoleGetReport["event"] = null;
  const capture = await targetConsoleTail({
    targetId: opts.targetId,
    timeoutMs: opts.timeoutMs,
    sessionId: opts.sessionId,
    captureMs: opts.captureMs,
    levels: opts.levels,
    reload: opts.reload,
    maxEvents: CONSOLE_TAIL_MAX_EVENTS,
    onEvent: (row) => {
      if (event !== null) {
        return;
      }
      const parsed = toConsoleGetEvent(row);
      if (!parsed) {
        return;
      }
      if (contains && !parsed.text.includes(contains)) {
        return;
      }
      event = parsed;
    },
  });
  return {
    ok: true,
    sessionId: capture.sessionId,
    sessionSource: capture.sessionSource,
    targetId: capture.targetId,
    event,
    captureMs: capture.captureMs,
    seen: capture.seen,
    timingMs: {
      total: Math.max(0, Date.now() - startedAt),
    },
  };
}

export async function targetHealth(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
}): Promise<TargetHealthReport> {
  const startedAt = Date.now();
  const targetId = sanitizeTargetId(opts.targetId);
  const { session, sessionSource } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: targetId,
  });
  const resolvedSessionAt = Date.now();
  const browser = await connectSessionBrowser(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();
  try {
    const target = await resolveTargetHandle(browser, targetId);
    const cdp = await openCdpSession(target.page);
    const frameTree = await getCdpFrameTree(cdp);
    const frameCount = listCdpFrameEntries({ frameTree, limit: 1 }).count;
    const worldCache = new Map<string, number>();
    const evaluator = createCdpEvaluator({
      cdp,
      frameCdpId: frameTree.frame.id,
      worldCache,
    });
    const pageMetrics = await evaluator.evaluate(() => {
      const runtime = globalThis as unknown as BrowserRuntimeLike;
      const doc = runtime.document;
      return {
        readyState: doc?.readyState ?? "unknown",
        visibilityState: doc?.visibilityState ?? "unknown",
        domNodes: doc?.querySelectorAll?.("*")?.length ?? 0,
        headings: doc?.querySelectorAll?.("h1,h2,h3")?.length ?? 0,
        buttons: doc?.querySelectorAll?.("button,[role=button],input[type=button],input[type=submit],input[type=reset]")?.length ?? 0,
        links: doc?.querySelectorAll?.("a[href]")?.length ?? 0,
        forms: doc?.querySelectorAll?.("form")?.length ?? 0,
        scripts: doc?.querySelectorAll?.("script")?.length ?? 0,
        images: doc?.querySelectorAll?.("img")?.length ?? 0,
      };
    });
    const metrics = {
      ...pageMetrics,
      frameCount,
    };
    const actionCompletedAt = Date.now();
    const checks: TargetHealthReport["checks"] = [
      {
        id: "ready-state",
        ok: metrics.readyState === "complete" || metrics.readyState === "interactive",
        actual: metrics.readyState,
        expected: "interactive|complete",
      },
      {
        id: "dom-nodes",
        ok: metrics.domNodes > 0,
        actual: metrics.domNodes,
        expected: ">0",
      },
    ];
    const hints: string[] = [];
    if (!checks[0].ok) {
      hints.push("Page not ready yet; run target wait --network-idle or --for-selector before extraction.");
    }
    if (metrics.frameCount > 1) {
      hints.push("Multiple frames detected; use --frame-scope main|all on read/snapshot/extract.");
    }

    return {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId,
      url: target.page.url(),
      title: await target.page.title(),
      actionId: readRecentTargetAction({
        targetId,
        sessionId: session.sessionId,
      }),
      readyState: metrics.readyState,
      visibilityState: metrics.visibilityState,
      metrics,
      checks,
      hints,
      timingMs: {
        total: actionCompletedAt - startedAt,
        resolveSession: resolvedSessionAt - startedAt,
        connectCdp: connectedAt - resolvedSessionAt,
        action: actionCompletedAt - connectedAt,
      },
    };
  } finally {
    await browser.close();
  }
}

export async function targetHud(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
}): Promise<TargetHudReport> {
  const health = await targetHealth({
    targetId: opts.targetId,
    timeoutMs: opts.timeoutMs,
    sessionId: opts.sessionId,
  });
  return {
    ok: true,
    sessionId: health.sessionId,
    sessionSource: health.sessionSource,
    targetId: health.targetId,
    url: health.url,
    title: health.title,
    actionId: health.actionId,
    panels: {
      readiness: {
        readyState: health.readyState,
        visibilityState: health.visibilityState,
        checksPassed: health.checks.filter((entry) => entry.ok).length,
        checksTotal: health.checks.length,
      },
      content: {
        frameCount: health.metrics.frameCount,
        domNodes: health.metrics.domNodes,
        headings: health.metrics.headings,
        buttons: health.metrics.buttons,
        links: health.metrics.links,
        forms: health.metrics.forms,
        images: health.metrics.images,
      },
      hints: health.hints,
    },
    timingMs: health.timingMs,
  };
}
