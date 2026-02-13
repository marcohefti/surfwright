import { chromium } from "playwright-core";
import { CliError } from "../errors.js";
import { nowIso } from "../state.js";
import { saveTargetSnapshot } from "../state-repos/target-repo.js";
import { DEFAULT_TARGET_READ_CHUNK_SIZE } from "../types.js";
import { ensureValidSelector, normalizeSelectorQuery, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "./targets.js";
import type { TargetReadReport } from "../types.js";

const READ_MAX_CHUNK_SIZE = 10000;
const READ_MAX_CHUNK_INDEX = 100000;

function parseChunkSize(value: number | undefined): number {
  const chunkSize = value ?? DEFAULT_TARGET_READ_CHUNK_SIZE;
  if (!Number.isFinite(chunkSize) || !Number.isInteger(chunkSize) || chunkSize <= 0 || chunkSize > READ_MAX_CHUNK_SIZE) {
    throw new CliError("E_QUERY_INVALID", `chunk-size must be an integer between 1 and ${READ_MAX_CHUNK_SIZE}`);
  }
  return chunkSize;
}

function parseChunkIndex(value: number | undefined): number {
  const chunkIndex = value ?? 1;
  if (!Number.isFinite(chunkIndex) || !Number.isInteger(chunkIndex) || chunkIndex <= 0 || chunkIndex > READ_MAX_CHUNK_INDEX) {
    throw new CliError("E_QUERY_INVALID", `chunk must be an integer between 1 and ${READ_MAX_CHUNK_INDEX}`);
  }
  return chunkIndex;
}

async function extractScopedText(opts: {
  page: { evaluate<T, Arg>(pageFunction: (arg: Arg) => T, arg: Arg): Promise<T> };
  selectorQuery: string | null;
  visibleOnly: boolean;
}): Promise<{ matched: boolean; text: string }> {
  return await opts.page.evaluate(
    ({ selectorQuery, visibleOnly }: { selectorQuery: string | null; visibleOnly: boolean }) => {
      const runtime = globalThis as unknown as { document?: any };
      const doc = runtime.document;
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const rootNode = selectorQuery ? doc?.querySelector?.(selectorQuery) ?? null : doc?.body ?? null;
      if (!rootNode) {
        return {
          matched: false,
          text: "",
        };
      }

      const textRaw = visibleOnly ? rootNode?.innerText ?? "" : rootNode?.textContent ?? "";
      return {
        matched: true,
        text: normalize(textRaw),
      };
    },
    {
      selectorQuery: opts.selectorQuery,
      visibleOnly: opts.visibleOnly,
    },
  );
}

export async function targetRead(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  selectorQuery?: string;
  visibleOnly?: boolean;
  chunkSize?: number;
  chunkIndex?: number;
}): Promise<TargetReadReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const selectorQuery = normalizeSelectorQuery(opts.selectorQuery);
  const visibleOnly = Boolean(opts.visibleOnly);
  const chunkSize = parseChunkSize(opts.chunkSize);
  const chunkIndex = parseChunkIndex(opts.chunkIndex);

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
    if (selectorQuery) {
      await ensureValidSelector(target.page, selectorQuery);
    }

    const scopedText = await extractScopedText({
      page: target.page,
      selectorQuery,
      visibleOnly,
    });

    const totalChars = scopedText.text.length;
    const totalChunks = Math.max(1, Math.ceil(totalChars / chunkSize));
    if (chunkIndex > totalChunks) {
      throw new CliError("E_QUERY_INVALID", `chunk must be between 1 and ${totalChunks}`);
    }

    const start = (chunkIndex - 1) * chunkSize;
    const text = scopedText.text.slice(start, start + chunkSize);
    const actionCompletedAt = Date.now();

    const report: TargetReadReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      url: target.page.url(),
      title: await target.page.title(),
      scope: {
        selector: selectorQuery,
        matched: scopedText.matched,
        visibleOnly,
      },
      chunkSize,
      chunkIndex,
      totalChunks,
      totalChars,
      text,
      truncated: chunkIndex < totalChunks,
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
