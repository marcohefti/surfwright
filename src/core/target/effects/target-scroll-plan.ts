import { chromium } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state.js";
import { saveTargetSnapshot } from "../../state-repos/target-repo.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";
import type { TargetScrollPlanReport } from "./types.js";

const DEFAULT_SCROLL_PLAN_SETTLE_MS = 300;
const MAX_SCROLL_PLAN_STEPS = 200;
const MAX_SCROLL_PLAN_POSITION = 1_000_000;
const MAX_SCROLL_PLAN_SETTLE_MS = 10_000;

function parseStepsCsv(input: string | undefined): number[] {
  const raw = typeof input === "string" ? input.trim() : "";
  if (raw.length === 0) {
    throw new CliError("E_QUERY_INVALID", "steps is required and must be a comma-separated list of non-negative integers");
  }

  const parts = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (parts.length === 0) {
    throw new CliError("E_QUERY_INVALID", "steps must include at least one position");
  }
  if (parts.length > MAX_SCROLL_PLAN_STEPS) {
    throw new CliError("E_QUERY_INVALID", `steps must contain at most ${MAX_SCROLL_PLAN_STEPS} values`);
  }

  const values: number[] = [];
  for (const part of parts) {
    const value = Number.parseInt(part, 10);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new CliError("E_QUERY_INVALID", `Invalid steps value: ${part}`);
    }
    if (value < 0 || value > MAX_SCROLL_PLAN_POSITION) {
      throw new CliError("E_QUERY_INVALID", `steps values must be between 0 and ${MAX_SCROLL_PLAN_POSITION}`);
    }
    values.push(value);
  }

  return values;
}

function parseSettleMs(input: number | undefined): number {
  if (typeof input === "undefined") {
    return DEFAULT_SCROLL_PLAN_SETTLE_MS;
  }
  if (!Number.isFinite(input) || !Number.isInteger(input) || input < 0 || input > MAX_SCROLL_PLAN_SETTLE_MS) {
    throw new CliError("E_QUERY_INVALID", `settle-ms must be an integer between 0 and ${MAX_SCROLL_PLAN_SETTLE_MS}`);
  }
  return input;
}

export async function targetScrollPlan(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  stepsCsv?: string;
  settleMs?: number;
}): Promise<TargetScrollPlanReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const requestedSteps = parseStepsCsv(opts.stepsCsv);
  const settleMs = parseSettleMs(opts.settleMs);

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
    const runtimeInfo = await target.page.evaluate(() => {
      const runtime = globalThis as unknown as {
        document?: {
          scrollingElement?: {
            scrollHeight?: number;
          } | null;
        } | null;
        window?: {
          innerHeight?: number;
          innerWidth?: number;
          scrollY?: number;
          scrollTo?: (x: number, y: number) => void;
        } | null;
      };
      const scrollHeight = runtime.document?.scrollingElement?.scrollHeight ?? 0;
      const innerHeight = runtime.window?.innerHeight ?? 0;
      const maxScroll = Math.max(0, Math.round(scrollHeight - innerHeight));
      return {
        maxScroll,
        viewportWidth: runtime.window?.innerWidth ?? 0,
        viewportHeight: runtime.window?.innerHeight ?? 0,
      };
    });

    const steps: TargetScrollPlanReport["steps"] = [];
    for (let idx = 0; idx < requestedSteps.length; idx += 1) {
      const requestedY = requestedSteps[idx];
      const appliedY = Math.max(0, Math.min(requestedY, runtimeInfo.maxScroll));
      await target.page.evaluate(
        ({ y }: { y: number }) => {
          const runtime = globalThis as unknown as {
            window?: {
              scrollTo?: (x: number, y: number) => void;
            } | null;
          };
          runtime.window?.scrollTo?.(0, y);
        },
        { y: appliedY },
      );
      if (settleMs > 0) {
        await target.page.waitForTimeout(settleMs);
      }
      const achievedY = await target.page.evaluate(() => {
        const runtime = globalThis as unknown as {
          window?: {
            scrollY?: number;
          } | null;
        };
        return Math.round(runtime.window?.scrollY ?? 0);
      });
      steps.push({
        index: idx,
        requestedY,
        appliedY,
        achievedY,
        deltaY: achievedY - requestedY,
      });
    }

    const actionCompletedAt = Date.now();
    const report: TargetScrollPlanReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      actionId: newActionId(),
      settleMs,
      maxScroll: runtimeInfo.maxScroll,
      viewport: {
        width: runtimeInfo.viewportWidth,
        height: runtimeInfo.viewportHeight,
      },
      steps,
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
        lastActionKind: "scroll-plan",
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
