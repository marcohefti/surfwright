import { chromium } from "playwright-core";
import { CliError } from "../../../errors.js";
import { nowIso, saveTargetSnapshot } from "../../../state/index.js";
import { parseTargetQueryInput } from "../target-query.js";
import { parseFrameScope } from "../target-find.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";
import {
  createCdpEvaluator,
  ensureValidSelectorSyntaxCdp,
  frameIdsForScope,
  getCdpFrameTree,
  listCdpFrameEntries,
  openCdpSession,
} from "../cdp/index.js";
import type { BrowserNodeLike, BrowserRuntimeLike } from "../types/browser-dom-types.js";
import type { TargetAttrReport } from "../../../types.js";
import { connectSessionBrowser } from "../../../session/infra/runtime-access.js";

const URL_ATTRIBUTE_NAMES = ["href", "src", "action", "formaction", "poster", "cite"];
const ATTR_MAX_INDEX = 5000;

type ParsedAttrInput = {
  query: ReturnType<typeof parseTargetQueryInput>;
  attributeName: string;
  index: number;
};

type FrameAttrPayload = {
  filteredCount: number;
  matches: Array<{
    localIndex: number;
    text: string;
    visible: boolean;
    selectorHint: string | null;
    tag: string | null;
    attributePresent: boolean;
    value: string | null;
  }>;
};

type CollectedAttrMatch = Omit<FrameAttrPayload["matches"][number], "localIndex"> & {
  index: number;
  frameId: string;
};

function parseAttributeName(input: string): string {
  const name = input.trim().toLowerCase();
  if (name.length < 1) {
    throw new CliError("E_QUERY_INVALID", "attribute name must not be empty");
  }
  if (!/^[a-z_][a-z0-9_:-]*$/u.test(name)) {
    throw new CliError("E_QUERY_INVALID", "attribute name must match [a-z_][a-z0-9_:-]*");
  }
  return name;
}

function parseRequestedIndex(input: number | undefined): number {
  const value = input ?? 0;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > ATTR_MAX_INDEX) {
    throw new CliError("E_QUERY_INVALID", `index must be an integer between 0 and ${ATTR_MAX_INDEX}`);
  }
  return value;
}

function parseAttrInput(opts: {
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
  attributeName: string;
  index?: number;
}): ParsedAttrInput {
  return {
    query: parseTargetQueryInput({
      textQuery: opts.textQuery,
      selectorQuery: opts.selectorQuery,
      containsQuery: opts.containsQuery,
      visibleOnly: opts.visibleOnly,
    }),
    attributeName: parseAttributeName(opts.attributeName),
    index: parseRequestedIndex(opts.index),
  };
}

export async function targetAttr(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
  frameScope?: string;
  attributeName: string;
  index?: number;
}): Promise<TargetAttrReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseAttrInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    containsQuery: opts.containsQuery,
    visibleOnly: opts.visibleOnly,
    attributeName: opts.attributeName,
    index: opts.index,
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
    const frameListing = listCdpFrameEntries({ frameTree, limit: Number.MAX_SAFE_INTEGER });
    const stableFrameIdByCdpId = new Map(frameListing.entries.map((entry) => [entry.cdpFrameId, entry.frameId]));
    const worldCache = new Map<string, number>();

    if (parsed.query.mode === "selector" && typeof parsed.query.selector === "string") {
      await ensureValidSelectorSyntaxCdp({
        cdp,
        frameCdpId: frameTree.frame.id,
        worldCache,
        selectorQuery: parsed.query.selector,
      });
    }

    let filteredCount = 0;
    let globalIndexOffset = 0;
    const matches: CollectedAttrMatch[] = [];

    for (const frameCdpId of frameIds) {
      const evaluator = createCdpEvaluator({
        cdp,
        frameCdpId,
        worldCache,
      });
      const remaining = Math.max(0, parsed.index + 1 - matches.length);
      const framePayload = await evaluator.evaluate<
        FrameAttrPayload,
        {
          mode: "text" | "selector";
          query: string;
          selector: string | null;
          contains: string | null;
          visibleOnly: boolean;
          attributeName: string;
          urlAttributeNames: string[];
          take: number;
        }
      >(
        ({
          mode,
          query,
          selector,
          contains,
          visibleOnly,
          attributeName,
          urlAttributeNames,
          take,
        }: {
          mode: "text" | "selector";
          query: string;
          selector: string | null;
          contains: string | null;
          visibleOnly: boolean;
          attributeName: string;
          urlAttributeNames: string[];
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
          const attributeValueFor = (
            node: BrowserNodeLike | null,
          ): { attributePresent: boolean; value: string | null } => {
            if (!node || node.hasAttribute?.(attributeName) !== true) {
              return { attributePresent: false, value: null };
            }
            const raw = typeof node.getAttribute === "function" ? node.getAttribute(attributeName) : null;
            const value = typeof raw === "string" ? raw.trim() : "";
            if (!urlAttributeNames.includes(attributeName) || value.length === 0) {
              return { attributePresent: true, value };
            }
            try {
              return {
                attributePresent: true,
                value: new URL(value, doc?.baseURI ?? undefined).toString(),
              };
            } catch {
              return { attributePresent: true, value };
            }
          };

          const queryLower = normLower(query);
          const containsLower = typeof contains === "string" && contains.trim().length > 0 ? normLower(contains) : null;
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
            tag: string | null;
            attributePresent: boolean;
            value: string | null;
          }> = [];
          for (const node of candidates) {
            const visible = isVisible(node);
            if (visibleOnly && !visible) {
              continue;
            }
            const filteredIndex = filteredCount;
            filteredCount += 1;
            if (out.length >= take) {
              continue;
            }
            const attr = attributeValueFor(node);
            out.push({
              localIndex: filteredIndex,
              text: normalize(String(textFor(node) ?? "")).slice(0, 180),
              visible,
              selectorHint: selectorHintFor(node),
              tag: tagFor(node),
              attributePresent: attr.attributePresent,
              value: attr.value,
            });
          }

          return { filteredCount, matches: out };
        },
        {
          mode: parsed.query.mode,
          query: parsed.query.query,
          selector: parsed.query.selector,
          contains: parsed.query.contains,
          visibleOnly: parsed.query.visibleOnly,
          attributeName: parsed.attributeName,
          urlAttributeNames: URL_ATTRIBUTE_NAMES,
          take: remaining,
        },
      );

      for (const match of framePayload.matches) {
        if (matches.length >= parsed.index + 1) break;
        matches.push({
          index: globalIndexOffset + match.localIndex,
          frameId: stableFrameIdByCdpId.get(frameCdpId) ?? frameCdpId,
          text: match.text,
          visible: match.visible,
          selectorHint: match.selectorHint,
          tag: match.tag,
          attributePresent: match.attributePresent,
          value: match.value,
        });
      }

      filteredCount += framePayload.filteredCount;
      globalIndexOffset += framePayload.filteredCount;
    }

    if (filteredCount < 1) {
      throw new CliError("E_QUERY_INVALID", `No element matched query: ${parsed.query.query}`);
    }
    if (parsed.index >= filteredCount) {
      throw new CliError("E_QUERY_INVALID", `index ${parsed.index} is out of range for ${filteredCount} matches`);
    }

    const picked = matches.find((entry) => entry.index === parsed.index);
    if (!picked) {
      throw new CliError("E_INTERNAL", "Unable to resolve requested attribute match from candidate set");
    }

    const actionCompletedAt = Date.now();
    const report: TargetAttrReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      mode: parsed.query.mode,
      selector: parsed.query.selector,
      contains: parsed.query.contains,
      visibleOnly: parsed.query.visibleOnly,
      query: parsed.query.query,
      frameScope,
      attribute: parsed.attributeName,
      requestedIndex: parsed.index,
      matchCount: filteredCount,
      pickedIndex: picked.index,
      attributePresent: picked.attributePresent,
      value: picked.value,
      picked: {
        index: picked.index,
        frameId: picked.frameId,
        text: picked.text,
        visible: picked.visible,
        selectorHint: picked.selectorHint,
        tag: picked.tag,
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
