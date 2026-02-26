import { chromium } from "playwright-core";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { parseTargetQueryInput } from "./target-query.js";
import { DEFAULT_TARGET_FIND_LIMIT } from "../../types.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "./targets.js";
import type { BrowserNodeLike, BrowserRuntimeLike } from "./types/browser-dom-types.js";
import type { TargetFindReport } from "../../types.js";
import { connectSessionBrowser } from "../../session/infra/runtime-access.js";
import {
  createCdpEvaluator,
  ensureValidSelectorSyntaxCdp,
  frameIdsForScope,
  getCdpFrameTree,
  openCdpSession,
} from "./cdp/index.js";

const FIND_MAX_LIMIT = 50;

type ParsedFindInput = {
  query: ReturnType<typeof parseTargetQueryInput>;
  limit: number;
  first: boolean;
  hrefHost: string | null;
  hrefPathPrefix: string | null;
};
type FrameMatchPayload = {
  filteredCount: number;
  matches: Array<{
    localIndex: number;
    text: string;
    visible: boolean;
    selectorHint: string | null;
    href: string | null;
    tag: string | null;
  }>;
};

export type FrameScope = "main" | "all";

export function parseFrameScope(input: string | undefined): FrameScope {
  if (typeof input === "undefined") {
    return "main";
  }
  const normalized = input.trim().toLowerCase();
  if (normalized === "main" || normalized === "all") {
    return normalized;
  }
  throw new CliError("E_QUERY_INVALID", "frame-scope must be one of: main, all");
}

export function frameScopeHints(opts: {
  frameScope: FrameScope;
  frameCount: number;
  command: "target.read" | "target.snapshot" | "target.extract";
  targetId: string;
}): string[] {
  if (opts.frameCount <= 1 || opts.frameScope !== "main") {
    return [];
  }
  return [
    `Multiple frames detected (${opts.frameCount}). Using main frame only by default.`,
    `To include embedded frames, rerun: surfwright ${opts.command} ${opts.targetId} --frame-scope all`,
  ];
}

function parseFindInput(opts: {
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  hrefHost?: string;
  hrefPathPrefix?: string;
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
    hrefHost: normalizeHrefHost(opts.hrefHost),
    hrefPathPrefix: normalizeHrefPathPrefix(opts.hrefPathPrefix),
  };
}

function normalizeHrefHost(input: string | undefined): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const value = input.trim();
  if (value.length === 0) {
    throw new CliError("E_QUERY_INVALID", "href-host must not be empty");
  }
  const candidate = value.includes("://") ? value : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new CliError("E_QUERY_INVALID", "href-host must be a valid hostname or URL");
  }
  const host = parsed.hostname.trim().toLowerCase();
  if (host.length === 0) {
    throw new CliError("E_QUERY_INVALID", "href-host must be a valid hostname or URL");
  }
  return host;
}

function normalizeHrefPathPrefix(input: string | undefined): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const value = input.trim();
  if (value.length === 0) {
    throw new CliError("E_QUERY_INVALID", "href-path-prefix must not be empty");
  }
  if (!value.startsWith("/")) {
    throw new CliError("E_QUERY_INVALID", "href-path-prefix must start with '/'");
  }
  return value;
}

export async function targetFind(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  hrefHost?: string;
  hrefPathPrefix?: string;
  limit?: number;
  first?: boolean;
  visibleOnly?: boolean;
  frameScope?: string;
}): Promise<TargetFindReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseFindInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    containsQuery: opts.containsQuery,
    hrefHost: opts.hrefHost,
    hrefPathPrefix: opts.hrefPathPrefix,
    limit: opts.limit,
    first: opts.first,
    visibleOnly: opts.visibleOnly,
  });
  const frameScope = parseFrameScope(opts.frameScope);

  const { session, sessionSource } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: requestedTargetId,
  });
  const resolvedSessionAt = Date.now();
  const browser = await connectSessionBrowser(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    const cdp = await openCdpSession(target.page);
    const frameTree = await getCdpFrameTree(cdp);
    const frameIds = frameIdsForScope({ frameTree, scope: frameScope });

    const worldCache = new Map<string, number>();
    if (parsed.query.mode === "selector" && typeof parsed.query.selector === "string") {
      await ensureValidSelectorSyntaxCdp({
        cdp,
        frameCdpId: frameTree.frame.id,
        worldCache,
        selectorQuery: parsed.query.selector,
      });
    }

    const matches: TargetFindReport["matches"] = [];
    let filteredCount = 0;
    let globalIndexOffset = 0;

    // Accumulate across frames in a deterministic order (frame tree order).
    for (const frameCdpId of frameIds) {
      const evaluator = createCdpEvaluator({
        cdp,
        frameCdpId,
        worldCache,
      });
      const remaining = Math.max(0, parsed.limit - matches.length);
      const framePayload = await evaluator.evaluate<
        FrameMatchPayload,
        {
          mode: "text" | "selector";
          query: string;
          selector: string | null;
          contains: string | null;
          hrefHost: string | null;
          hrefPathPrefix: string | null;
          visibleOnly: boolean;
          take: number;
        }
      >(
        ({
          mode,
          query,
          selector,
          contains,
          hrefHost,
          hrefPathPrefix,
          visibleOnly,
          take,
        }: {
          mode: "text" | "selector";
          query: string;
          selector: string | null;
          contains: string | null;
          hrefHost: string | null;
          hrefPathPrefix: string | null;
          visibleOnly: boolean;
          take: number;
        }) => {
          const runtime = globalThis as unknown as BrowserRuntimeLike;
          const doc = runtime.document;
          const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
          const normLower = (value: string): string => normalize(value).toLowerCase();
          const selectorHintFor = (node: BrowserNodeLike | null): string | null => {
            const el = node;
            const classListRaw = typeof el?.className === "string" ? normalize(el.className) : "";
            const classSuffix =
              classListRaw.length > 0
                ? classListRaw
                    .split(" ")
                    .filter((entry) => entry.length > 0)
                    .slice(0, 2)
                    .map((entry) => `.${entry}`)
                    .join("")
                : "";
            const tag = typeof el?.tagName === "string" ? el.tagName.toLowerCase() : "";
            const id = typeof el?.id === "string" && el.id.length > 0 ? `#${el.id}` : "";
            return tag.length > 0 ? `${tag}${id}${classSuffix}` : null;
          };
          const isVisible = (node: BrowserNodeLike | null): boolean => {
            if (!node) return false;
            if (node.hasAttribute?.("hidden")) return false;
            const style = runtime.getComputedStyle?.(node);
            if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return false;
            return (node.getClientRects?.().length ?? 0) > 0;
          };
          const textFor = (node: BrowserNodeLike | null): string => {
            const el = node;
            const tag = typeof el?.tagName === "string" ? el.tagName.toLowerCase() : "";
            if (tag === "input" || tag === "textarea" || tag === "select") {
              return (
                el?.getAttribute?.("aria-label") ??
                el?.getAttribute?.("placeholder") ??
                el?.getAttribute?.("name") ??
                el?.id ??
                el?.value ??
                ""
              );
            }
            return el?.innerText ?? el?.textContent ?? el?.getAttribute?.("aria-label") ?? el?.getAttribute?.("title") ?? "";
          };
          const tagFor = (node: BrowserNodeLike | null): string | null => {
            const tag = typeof node?.tagName === "string" ? node.tagName.toLowerCase() : "";
            return tag.length > 0 ? tag : null;
          };
          const hrefFor = (node: BrowserNodeLike | null): string | null => {
            if (!node) return null;
            const anchor =
              node?.matches?.("a[href]") === true
                ? node
                : (node?.closest?.("a[href]") ?? node?.querySelector?.("a[href]") ?? null);
            const href = typeof anchor?.href === "string" ? anchor.href.trim() : "";
            return href.length > 0 ? href : null;
          };

          const queryLower = normLower(query);
          const containsLower = typeof contains === "string" && contains.trim().length > 0 ? normLower(contains) : null;
          const hrefHostLower = typeof hrefHost === "string" ? hrefHost.toLowerCase() : null;
          const hrefPathPrefixNorm = typeof hrefPathPrefix === "string" ? hrefPathPrefix : null;

          const root = doc?.body ?? null;
          if (!root) {
            return { filteredCount: 0, matches: [] };
          }

          let candidates: BrowserNodeLike[] = [];
          if (mode === "selector") {
            const sel = selector ?? "";
            const nodes = Array.from(root.querySelectorAll?.(sel) ?? []);
            candidates = containsLower
              ? nodes.filter((node) => normLower(textFor(node)).includes(containsLower))
              : nodes;
          } else {
            // Bounded and globally reusable: search across common interactive/label elements + headings.
            const candidateSelector =
              "a,button,input,textarea,select,option,label,summary,[role=\"button\"],[role=\"link\"],[role=\"menuitem\"],[role=\"tab\"],[role=\"checkbox\"],[role=\"radio\"],[role=\"option\"],[role=\"heading\"],h1,h2,h3,h4,h5,h6,[tabindex]:not([tabindex=\"-1\"])";
            const nodes = Array.from(root.querySelectorAll?.(candidateSelector) ?? []);
            candidates = nodes.filter((node) => normLower(textFor(node)).includes(queryLower));
          }

          let filteredCount = 0;
          const out: Array<{
            localIndex: number;
            text: string;
            visible: boolean;
            selectorHint: string | null;
            href: string | null;
            tag: string | null;
          }> = [];
          for (const node of candidates) {
            const visible = isVisible(node);
            if (visibleOnly && !visible) {
              continue;
            }
            const href = hrefFor(node);
            if (hrefHostLower || hrefPathPrefixNorm) {
              if (!href) {
                continue;
              }
              let hrefUrl: URL;
              try {
                hrefUrl = new URL(href, doc?.baseURI ?? undefined);
              } catch {
                continue;
              }
              if (hrefHostLower && hrefUrl.hostname.toLowerCase() !== hrefHostLower) {
                continue;
              }
              if (hrefPathPrefixNorm && !hrefUrl.pathname.startsWith(hrefPathPrefixNorm)) {
                continue;
              }
            }
            const filteredIndex = filteredCount;
            filteredCount += 1;
            if (out.length >= take) {
              continue;
            }
            const text = normalize(String(textFor(node) ?? "")).slice(0, 180);
            out.push({
              localIndex: filteredIndex,
              text,
              visible,
              selectorHint: selectorHintFor(node),
              href,
              tag: tagFor(node),
            });
          }

          return { filteredCount, matches: out };
        },
        {
          mode: parsed.query.mode,
          query: parsed.query.query,
          selector: parsed.query.selector,
          contains: parsed.query.contains,
          hrefHost: parsed.hrefHost,
          hrefPathPrefix: parsed.hrefPathPrefix,
          visibleOnly: parsed.query.visibleOnly,
          take: remaining,
        },
      );

      for (const match of framePayload.matches) {
        if (matches.length >= parsed.limit) break;
        matches.push({
          index: globalIndexOffset + match.localIndex,
          text: match.text,
          visible: match.visible,
          selectorHint: match.selectorHint,
          href: match.href,
          tag: match.tag,
        });
      }

      filteredCount += framePayload.filteredCount;
      globalIndexOffset += framePayload.filteredCount;
      if (matches.length >= parsed.limit) {
        // Still need full filteredCount across remaining frames, so keep scanning.
        continue;
      }
    }
    const actionCompletedAt = Date.now();

    const report: TargetFindReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      mode: parsed.query.mode,
      selector: parsed.query.selector,
      contains: parsed.query.contains,
      hrefHost: parsed.hrefHost,
      hrefPathPrefix: parsed.hrefPathPrefix,
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
