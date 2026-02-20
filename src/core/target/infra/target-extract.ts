import { chromium } from "playwright-core";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { fetchAssistedExtractItems, type ExtractItemDraft } from "./target-extract-assist.js";
import { frameScopeHints, parseFrameScope } from "./target-find.js";
import { createCdpEvaluator, ensureValidSelectorSyntaxCdp, frameIdsForScope, getCdpFrameTree, listCdpFrameEntries, openCdpSession } from "./cdp/index.js";
import { normalizeSelectorQuery, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "./targets.js";
import { extractFrameItems } from "./query/target-extract-frame.js";
import type { TargetExtractReport } from "../../types.js";

const EXTRACT_MAX_LIMIT = 100;

function parseLimit(input: number | undefined): number {
  const value = input ?? 12;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > EXTRACT_MAX_LIMIT) {
    throw new CliError("E_QUERY_INVALID", `limit must be an integer between 1 and ${EXTRACT_MAX_LIMIT}`);
  }
  return value;
}

function parseKind(input: string | undefined): TargetExtractReport["kind"] {
  if (typeof input === "undefined" || input.trim().length === 0) {
    return "generic";
  }
  const normalized = input.trim().toLowerCase();
  if (
    normalized === "blog" ||
    normalized === "news" ||
    normalized === "docs" ||
    normalized === "docs-commands" ||
    normalized === "headings" ||
    normalized === "links" ||
    normalized === "codeblocks" ||
    normalized === "forms" ||
    normalized === "tables" ||
    normalized === "generic"
  ) {
    return normalized;
  }
  throw new CliError(
    "E_QUERY_INVALID",
    "kind must be one of: generic, blog, news, docs, docs-commands, headings, links, codeblocks, forms, tables",
  );
}

export async function targetExtract(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  kind?: string;
  selectorQuery?: string;
  visibleOnly?: boolean;
  frameScope?: string;
  limit?: number;
  includeActionable?: boolean;
}): Promise<TargetExtractReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const selectorQuery = normalizeSelectorQuery(opts.selectorQuery);
  const visibleOnly = Boolean(opts.visibleOnly);
  const frameScope = parseFrameScope(opts.frameScope);
  const kind = parseKind(opts.kind);
  const limit = parseLimit(opts.limit);
  const includeActionable = Boolean(opts.includeActionable);

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
    const pageUrl = target.page.url();
    const cdp = await openCdpSession(target.page);
    const frameTree = await getCdpFrameTree(cdp);
    const frameCount = listCdpFrameEntries({ frameTree, limit: 1 }).count;
    const frameIds = frameIdsForScope({ frameTree, scope: frameScope });
    const allEntries = listCdpFrameEntries({ frameTree, limit: Number.MAX_SAFE_INTEGER }).entries;
    const urlByFrameId = new Map<string, string>();
    for (const entry of allEntries) {
      urlByFrameId.set(entry.cdpFrameId, entry.url);
    }
    const hints = frameScopeHints({
      frameScope,
      frameCount,
      command: "target.extract",
      targetId: requestedTargetId,
    });
    const worldCache = new Map<string, number>();
    if (selectorQuery) {
      await ensureValidSelectorSyntaxCdp({
        cdp,
        frameCdpId: frameTree.frame.id,
        worldCache,
        selectorQuery,
      });
    }

    let scopeMatched = false;
    const seen = new Set<string>();
    const merged: TargetExtractReport["items"] = [];
    const sourcesTried: string[] = ["dom"];
    let source: TargetExtractReport["source"] = "dom";
    let totalRawCount = 0;

    const pushItem = (item: ExtractItemDraft) => {
      const title = item.title.trim();
      const url = typeof item.url === "string" && item.url.length > 0 ? item.url : null;
      const dedupeKey = `${url ?? "no-url"}::${title}`.toLowerCase();
      if (seen.has(dedupeKey) || merged.length >= limit) {
        return;
      }
      seen.add(dedupeKey);
      merged.push({
        index: merged.length,
        title,
        url,
        summary: item.summary,
        publishedAt: item.publishedAt,
        frameUrl: item.frameUrl,
        ...(typeof item.language !== "undefined" ? { language: item.language ?? null } : {}),
        ...(typeof item.command !== "undefined" ? { command: item.command ?? null } : {}),
        ...(typeof item.section !== "undefined" ? { section: item.section ?? null } : {}),
        ...(includeActionable
          ? {
              actionable: {
                handle: item.actionable?.handle ?? null,
                selectorHint: item.actionable?.selectorHint ?? null,
                frameId: item.actionable?.frameId ?? null,
                href: item.actionable?.href ?? url,
              },
            }
          : {}),
      });
    };

    for (const frameCdpId of frameIds) {
      const evaluator = createCdpEvaluator({
        cdp,
        frameCdpId,
        worldCache,
      });
      const extracted = await extractFrameItems({
        evaluator,
        frameUrl: urlByFrameId.get(frameCdpId) ?? pageUrl,
        frameId: frameCdpId,
        selectorQuery,
        visibleOnly,
        kind,
        scanLimit: limit,
        includeActionable,
      });
      scopeMatched = scopeMatched || extracted.matched;
      totalRawCount += extracted.items.length;
      for (const item of extracted.items) {
        pushItem(item);
      }
    }

    if ((kind === "generic" || kind === "blog" || kind === "news" || kind === "docs") && merged.length === 0) {
      const assisted = await fetchAssistedExtractItems({
        pageUrl,
        kind,
        limit,
      });
      if (assisted.sourcesTried.length > 0) {
        sourcesTried.push(...assisted.sourcesTried);
      }
      if (assisted.items.length > 0) {
        source = "api-feed";
        totalRawCount += assisted.items.length;
        for (const item of assisted.items) {
          pushItem(item);
        }
        hints.push("Structured items were recovered via API/feed fallback.");
      }
    }

    if (merged.length === 0) {
      hints.push(`No structured items found for kind=${kind}.`);
      hints.push(`Try: surfwright target extract ${requestedTargetId} --kind blog --frame-scope all --limit 10`);
      hints.push(`Try: surfwright target snapshot ${requestedTargetId} --frame-scope all --max-headings 30 --max-links 50`);
      hints.push(`Try: surfwright target health ${requestedTargetId}`);
    }

    const actionCompletedAt = Date.now();
    const report: TargetExtractReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      url: pageUrl,
      title: await target.page.title(),
      kind,
      source,
      sourcesTried,
      scope: {
        selector: selectorQuery,
        matched: scopeMatched,
        visibleOnly,
        frameScope,
      },
      limit,
      count: totalRawCount,
      items: merged,
      truncated: totalRawCount > merged.length,
      hints,
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
