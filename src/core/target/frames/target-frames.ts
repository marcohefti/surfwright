import { chromium } from "playwright-core";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../infra/targets.js";
import { listFrameEntries } from "./frames.js";
import type { TargetFramesReport } from "../../types.js";

const TARGET_FRAMES_LIMIT_MAX = 200;

function parseLimit(input: number | undefined): number {
  const value = input ?? 50;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > TARGET_FRAMES_LIMIT_MAX) {
    throw new CliError("E_QUERY_INVALID", `limit must be an integer between 1 and ${TARGET_FRAMES_LIMIT_MAX}`);
  }
  return value;
}

export async function targetFrames(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  limit?: number;
}): Promise<TargetFramesReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const limit = parseLimit(opts.limit);

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
    const frameListing = listFrameEntries(target.page, limit);
    const actionCompletedAt = Date.now();

    const report: TargetFramesReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      url: target.page.url(),
      title: await target.page.title(),
      count: frameListing.count,
      limit,
      frames: frameListing.frames,
      truncated: frameListing.truncated,
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
