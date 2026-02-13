import { chromium, type Locator } from "playwright-core";
import { CliError } from "../errors.js";
import { nowIso } from "../state.js";
import { saveTargetSnapshot } from "../state-repos/target-repo.js";
import { extractTargetQueryPreview, parseTargetQueryInput, resolveTargetQueryLocator } from "./target-query.js";
import { DEFAULT_TARGET_FIND_LIMIT } from "../types.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "./targets.js";
import type { TargetFindReport } from "../types.js";

const FIND_MAX_LIMIT = 50;

type ParsedFindInput = {
  query: ReturnType<typeof parseTargetQueryInput>;
  limit: number;
  first: boolean;
};

function parseFindInput(opts: {
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  limit?: number;
  first?: boolean;
  visibleOnly?: boolean;
}): ParsedFindInput {
  const first = Boolean(opts.first);
  const limitRaw = first ? 1 : (opts.limit ?? DEFAULT_TARGET_FIND_LIMIT);
  if (!Number.isFinite(limitRaw) || !Number.isInteger(limitRaw) || limitRaw <= 0 || limitRaw > FIND_MAX_LIMIT) {
    throw new CliError("E_QUERY_INVALID", `limit must be an integer between 1 and ${FIND_MAX_LIMIT}`);
  }

  return {
    query: parseTargetQueryInput({
      textQuery: opts.textQuery,
      selectorQuery: opts.selectorQuery,
      containsQuery: opts.containsQuery,
      visibleOnly: opts.visibleOnly,
    }),
    limit: limitRaw,
    first,
  };
}

export async function targetFind(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  limit?: number;
  first?: boolean;
  visibleOnly?: boolean;
}): Promise<TargetFindReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseFindInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    containsQuery: opts.containsQuery,
    limit: opts.limit,
    first: opts.first,
    visibleOnly: opts.visibleOnly,
  });

  const { session } = await resolveSessionForAction(opts.sessionId, opts.timeoutMs);
  const resolvedSessionAt = Date.now();
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    const { locator, count: rawCount } = await resolveTargetQueryLocator({
      page: target.page,
      parsed: parsed.query,
    });

    const matches: TargetFindReport["matches"] = [];
    let filteredCount = 0;

    for (let idx = 0; idx < rawCount; idx += 1) {
      const matchLocator: Locator = locator.nth(idx);
      let visible = false;
      try {
        visible = await matchLocator.isVisible();
      } catch {
        visible = false;
      }

      if (parsed.query.visibleOnly && !visible) {
        continue;
      }

      const filteredIndex = filteredCount;
      filteredCount += 1;

      if (matches.length >= parsed.limit) {
        continue;
      }

      const payload = await extractTargetQueryPreview(matchLocator);
      matches.push({
        index: filteredIndex,
        text: payload.text,
        visible,
        selectorHint: payload.selectorHint,
      });
    }
    const actionCompletedAt = Date.now();

    const report: TargetFindReport = {
      ok: true,
      sessionId: session.sessionId,
      targetId: requestedTargetId,
      mode: parsed.query.mode,
      selector: parsed.query.selector,
      contains: parsed.query.contains,
      visibleOnly: parsed.query.visibleOnly,
      first: parsed.first,
      query: parsed.query.query,
      count: filteredCount,
      limit: parsed.limit,
      matches,
      truncated: filteredCount > parsed.limit,
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
