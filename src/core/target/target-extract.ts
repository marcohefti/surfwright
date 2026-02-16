import { chromium } from "playwright-core";
import { CliError } from "../errors.js";
import { nowIso } from "../state/index.js";
import { saveTargetSnapshot } from "../state/index.js";
import { fetchAssistedExtractItems, normalizeExtractWhitespace, type ExtractItemDraft } from "./target-extract-assist.js";
import { frameScopeHints, framesForScope, parseFrameScope } from "./target-find.js";
import { ensureValidSelector, normalizeSelectorQuery, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "./targets.js";
import type { TargetExtractReport } from "../types.js";

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
  if (normalized === "blog" || normalized === "news" || normalized === "docs" || normalized === "generic") {
    return normalized;
  }
  throw new CliError("E_QUERY_INVALID", "kind must be one of: generic, blog, news, docs");
}

async function extractFrameItems(opts: {
  frame: {
    url(): string;
    evaluate<T, Arg>(pageFunction: (arg: Arg) => T, arg: Arg): Promise<T>;
  };
  selectorQuery: string | null;
  visibleOnly: boolean;
  kind: TargetExtractReport["kind"];
  scanLimit: number;
}): Promise<{ frameUrl: string; matched: boolean; items: ExtractItemDraft[] }> {
  const frameUrl = opts.frame.url();
  const payload = await opts.frame.evaluate(
    ({ selectorQuery, visibleOnly, kind, scanLimit }) => {
      const runtime = globalThis as unknown as { document?: any; getComputedStyle?: any };
      const doc = runtime.document;
      const isVisible = (node: any): boolean => {
        if (!node) {
          return false;
        }
        if (node.hasAttribute?.("hidden")) {
          return false;
        }
        const style = runtime.getComputedStyle?.(node);
        if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) {
          return false;
        }
        return (node.getClientRects?.().length ?? 0) > 0;
      };

      const rootNode = selectorQuery ? doc?.querySelector?.(selectorQuery) ?? null : doc?.body ?? null;
      if (!rootNode) {
        return { matched: false, items: [] };
      }

      const primarySelectorByKind: Record<TargetExtractReport["kind"], string> = {
        generic: "article,.post,.blog-post,.entry,.h-entry,main a[href]",
        blog: "article,.post,.blog-post,.entry,.h-entry",
        news: "article,.post,.entry,.news-item,.story",
        docs: "main a[href],article a[href],nav a[href]",
      };
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const primarySelector = primarySelectorByKind[kind];
      const primaryNodes: any[] = Array.from(rootNode.querySelectorAll?.(primarySelector) ?? []);
      const fallbackNodes: any[] = primaryNodes.length > 0 ? [] : Array.from(rootNode.querySelectorAll?.("a[href]") ?? []);
      const nodes: any[] = [...primaryNodes, ...fallbackNodes].slice(0, Math.max(scanLimit * 3, scanLimit));
      const items: Array<{ title: string; url: string | null; summary: string | null; publishedAt: string | null }> = [];
      for (const node of nodes) {
        if (visibleOnly && !isVisible(node)) {
          continue;
        }
        const link = node.matches?.("a[href]") ? node : node.querySelector?.("a[href]");
        if (visibleOnly && link && !isVisible(link)) {
          continue;
        }
        const heading = node.querySelector?.("h1,h2,h3");
        const title = normalize(
          (heading?.textContent ?? "") ||
            (link?.textContent ?? "") ||
            (node?.getAttribute?.("aria-label") ?? "") ||
            (node?.textContent ?? ""),
        );
        if (!title) {
          continue;
        }
        const href = typeof link?.href === "string" && link.href.length > 0 ? link.href : null;
        const timeNode = node.querySelector?.("time");
        const publishedAtRaw = timeNode?.getAttribute?.("datetime") ?? timeNode?.textContent ?? null;
        const publishedAt = typeof publishedAtRaw === "string" ? normalize(publishedAtRaw) || null : null;
        const summaryNode = node.querySelector?.("p");
        const summaryRaw = summaryNode?.textContent ?? null;
        const summary = typeof summaryRaw === "string" ? normalize(summaryRaw) || null : null;
        items.push({ title, url: href, summary, publishedAt });
      }
      return { matched: true, items };
    },
    {
      selectorQuery: opts.selectorQuery,
      visibleOnly: opts.visibleOnly,
      kind: opts.kind,
      scanLimit: opts.scanLimit,
    },
  );

  return {
    frameUrl,
    matched: payload.matched,
    items: payload.items.map((item) => ({
      title: normalizeExtractWhitespace(item.title),
      url: item.url,
      summary: item.summary,
      publishedAt: item.publishedAt,
      frameUrl,
    })),
  };
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
}): Promise<TargetExtractReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const selectorQuery = normalizeSelectorQuery(opts.selectorQuery);
  const visibleOnly = Boolean(opts.visibleOnly);
  const frameScope = parseFrameScope(opts.frameScope);
  const kind = parseKind(opts.kind);
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
    const pageUrl = target.page.url();
    const frames = framesForScope(target.page, frameScope);
    const hints = frameScopeHints({
      frameScope,
      frameCount: target.page.frames().length,
      command: "target.extract",
      targetId: requestedTargetId,
    });
    if (selectorQuery) {
      if (frameScope === "main") {
        await ensureValidSelector(target.page, selectorQuery);
      } else {
        for (const frame of frames) {
          try {
            await frame.locator(selectorQuery).count();
          } catch {
            throw new CliError("E_SELECTOR_INVALID", `Invalid selector query: ${selectorQuery}`);
          }
        }
      }
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
      });
    };

    for (const frame of frames) {
      const extracted = await extractFrameItems({
        frame,
        selectorQuery,
        visibleOnly,
        kind,
        scanLimit: limit,
      });
      scopeMatched = scopeMatched || extracted.matched;
      totalRawCount += extracted.items.length;
      for (const item of extracted.items) {
        pushItem(item);
      }
    }

    if (merged.length === 0) {
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
      hints.push(`Try: surfwright --json target extract ${requestedTargetId} --kind blog --frame-scope all --limit 10`);
      hints.push(`Try: surfwright --json target snapshot ${requestedTargetId} --frame-scope all --max-headings 30 --max-links 50`);
      hints.push(`Try: surfwright --json target health ${requestedTargetId}`);
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
