import { chromium } from "playwright-core";
import { CliError } from "../errors.js";
import { nowIso } from "../state.js";
import { saveTargetSnapshot } from "../state-repos/target-repo.js";
import { framesForScope, parseFrameScope } from "./target-frame.js";
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
}) {
  const frameUrl = opts.frame.url();
  const payload = await opts.frame.evaluate(
    ({
      selectorQuery,
      visibleOnly,
      kind,
      scanLimit,
    }: {
      selectorQuery: string | null;
      visibleOnly: boolean;
      kind: TargetExtractReport["kind"];
      scanLimit: number;
    }) => {
      const runtime = globalThis as unknown as { document?: any; getComputedStyle?: any };
      const doc = runtime.document;
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
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
        return {
          matched: false,
          items: [],
        };
      }

      const primarySelectorByKind: Record<TargetExtractReport["kind"], string> = {
        generic: "article,.post,.blog-post,.entry,.h-entry,main a[href]",
        blog: "article,.post,.blog-post,.entry,.h-entry",
        news: "article,.post,.entry,.news-item,.story",
        docs: "main a[href],article a[href],nav a[href]",
      };
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
        const href = typeof link?.href === "string" && link.href.length > 0 ? link.href : null;
        const timeNode = node.querySelector?.("time");
        const publishedAtRaw = timeNode?.getAttribute?.("datetime") ?? timeNode?.textContent ?? null;
        const publishedAt = typeof publishedAtRaw === "string" ? normalize(publishedAtRaw) || null : null;
        const summaryNode = node.querySelector?.("p");
        const summaryRaw = summaryNode?.textContent ?? null;
        const summary = typeof summaryRaw === "string" ? normalize(summaryRaw) || null : null;
        if (!title && !href) {
          continue;
        }
        items.push({
          title,
          url: href,
          summary,
          publishedAt,
        });
      }
      return {
        matched: true,
        items,
      };
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
    items: payload.items,
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
    const frames = framesForScope(target.page, frameScope);
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
    let totalRawCount = 0;
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
        const title = item.title.trim();
        const url = typeof item.url === "string" && item.url.length > 0 ? item.url : null;
        const dedupeKey = `${url ?? "no-url"}::${title}`.toLowerCase();
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);
        if (merged.length >= limit) {
          continue;
        }
        merged.push({
          index: merged.length,
          title,
          url,
          summary: item.summary,
          publishedAt: item.publishedAt,
          frameUrl: extracted.frameUrl,
        });
      }
    }
    const actionCompletedAt = Date.now();

    const report: TargetExtractReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      url: target.page.url(),
      title: await target.page.title(),
      kind,
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
