import type { TargetExtractReport } from "../../../types.js";
import { normalizeExtractWhitespace, type ExtractItemDraft } from "../target-extract-assist.js";
import type { BrowserNodeLike, BrowserRuntimeLike } from "../types/browser-dom-types.js";

type ExtractEvalItem = {
  title: string;
  url: string | null;
  summary: string | null;
  publishedAt: string | null;
  language?: string | null;
  command?: string | null;
  section?: string | null;
  actionable?: {
    handle: string | null;
    selectorHint: string | null;
    frameId: string | null;
    href: string | null;
  };
};

type ExtractFramePayload = {
  matched: boolean;
  items: ExtractEvalItem[];
};

export async function extractFrameItems(opts: {
  evaluator: {
    evaluate<T, Arg>(pageFunction: (arg: Arg) => T, arg: Arg): Promise<T>;
  };
  frameUrl: string;
  frameId: string;
  selectorQuery: string | null;
  visibleOnly: boolean;
  kind: TargetExtractReport["kind"];
  scanLimit: number;
  includeActionable: boolean;
}): Promise<{ frameUrl: string; matched: boolean; items: ExtractItemDraft[] }> {
  const frameUrl = opts.frameUrl;
  const payload = await opts.evaluator.evaluate<
    ExtractFramePayload,
    {
      selectorQuery: string | null;
      visibleOnly: boolean;
      kind: TargetExtractReport["kind"];
      scanLimit: number;
      includeActionable: boolean;
      frameId: string;
    }
  >(
    ({ selectorQuery, visibleOnly, kind, scanLimit, includeActionable, frameId }) => {
      const runtime = globalThis as unknown as BrowserRuntimeLike;
      const doc = runtime.document;
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const isVisible = (node: BrowserNodeLike | null): boolean => {
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

      const rootNode = selectorQuery ? doc?.querySelector?.(selectorQuery) ?? null : doc?.body ?? null;
      if (!rootNode) {
        return { matched: false, items: [] };
      }

      const languageFromNode = (node: BrowserNodeLike | null): string | null => {
        const classPool = [String(node?.className ?? ""), String(node?.parentElement?.className ?? "")]
          .join(" ")
          .trim();
        if (classPool.length === 0) {
          return null;
        }
        const languageMatch = classPool.match(/(?:^|\s)(?:lang|language)-([a-z0-9_+-]+)/i);
        if (!languageMatch || typeof languageMatch[1] !== "string") {
          return null;
        }
        return languageMatch[1].toLowerCase();
      };
      const sectionFromNode = (node: BrowserNodeLike | null): string | null => {
        let current = node;
        for (let depth = 0; depth < 10 && current; depth += 1) {
          let sibling = current.previousElementSibling ?? null;
          while (sibling) {
            const directHeading = sibling.matches?.("h1,h2,h3,h4,h5,h6")
              ? sibling
              : sibling.querySelector?.("h1,h2,h3,h4,h5,h6");
            if (directHeading) {
              const headingText = normalize(directHeading.textContent ?? "");
              if (headingText.length > 0) {
                return headingText;
              }
            }
            sibling = sibling.previousElementSibling ?? null;
          }
          current = current.parentElement ?? null;
        }
        return null;
      };

      if (kind === "headings") {
        const headingNodes: BrowserNodeLike[] = Array.from(rootNode.querySelectorAll?.("h1,h2,h3,h4,h5,h6") ?? []);
        const items: ExtractEvalItem[] = [];
        for (const node of headingNodes) {
          if (visibleOnly && !isVisible(node)) {
            continue;
          }
          const text = normalize(node?.textContent ?? "");
          if (text.length === 0) {
            continue;
          }
          const tagName = typeof node?.tagName === "string" ? node.tagName.toLowerCase() : "";
          const idValue = typeof node?.id === "string" && node.id.length > 0 ? `#${node.id}` : null;
          items.push({
            title: text,
            url: idValue,
            summary: tagName.length > 0 ? `level:${tagName}` : null,
            publishedAt: null,
            ...(includeActionable
              ? {
                  actionable: {
                    handle: null,
                    selectorHint: selectorHintFor(node),
                    frameId,
                    href: idValue,
                  },
                }
              : {}),
          });
          if (items.length >= Math.max(scanLimit * 3, scanLimit)) {
            break;
          }
        }
        return { matched: true, items };
      }

      if (kind === "links") {
        const linkNodes: BrowserNodeLike[] = Array.from(rootNode.querySelectorAll?.("a[href]") ?? []);
        const items: ExtractEvalItem[] = [];
        for (const node of linkNodes) {
          if (visibleOnly && !isVisible(node)) {
            continue;
          }
          const href = typeof node?.href === "string" && node.href.length > 0 ? node.href : null;
          const text = normalize(node?.textContent ?? "") || href || "";
          if (text.length === 0) {
            continue;
          }
          items.push({
            title: text,
            url: href,
            summary: sectionFromNode(node),
            publishedAt: null,
            ...(includeActionable
              ? {
                  actionable: {
                    handle: null,
                    selectorHint: selectorHintFor(node),
                    frameId,
                    href,
                  },
                }
              : {}),
          });
          if (items.length >= Math.max(scanLimit * 3, scanLimit)) {
            break;
          }
        }
        return { matched: true, items };
      }

      if (kind === "codeblocks") {
        const codeNodes: BrowserNodeLike[] = Array.from(rootNode.querySelectorAll?.("pre code,pre,code") ?? []);
        const items: ExtractEvalItem[] = [];
        for (const node of codeNodes) {
          if (visibleOnly && !isVisible(node)) {
            continue;
          }
          const snippetRaw = String(node?.innerText ?? node?.textContent ?? "").trim();
          if (snippetRaw.length === 0) {
            continue;
          }
          const firstLine = normalize(snippetRaw.split(/\r?\n/)[0] ?? "");
          const language = languageFromNode(node);
          items.push({
            title: firstLine.length > 0 ? firstLine : "code-block",
            url: null,
            summary: normalize(snippetRaw).slice(0, 240),
            publishedAt: null,
            language,
            ...(includeActionable
              ? {
                  actionable: {
                    handle: null,
                    selectorHint: selectorHintFor(node),
                    frameId,
                    href: null,
                  },
                }
              : {}),
          });
          if (items.length >= Math.max(scanLimit * 3, scanLimit)) {
            break;
          }
        }
        return { matched: true, items };
      }

      if (kind === "forms") {
        const formNodes: BrowserNodeLike[] = Array.from(rootNode.querySelectorAll?.("form") ?? []);
        const items: ExtractEvalItem[] = [];
        for (const node of formNodes) {
          if (visibleOnly && !isVisible(node)) {
            continue;
          }
          const title =
            normalize(node?.getAttribute?.("aria-label") ?? "") ||
            normalize(node?.querySelector?.("legend,h1,h2,h3,label")?.textContent ?? "") ||
            "form";
          const inputCount = Number(node?.querySelectorAll?.("input,textarea,select")?.length ?? 0);
          const buttonCount = Number(node?.querySelectorAll?.("button,[type='submit']")?.length ?? 0);
          items.push({
            title,
            url: null,
            summary: `inputs:${inputCount} buttons:${buttonCount}`,
            publishedAt: null,
            ...(includeActionable
              ? {
                  actionable: {
                    handle: null,
                    selectorHint: selectorHintFor(node),
                    frameId,
                    href: null,
                  },
                }
              : {}),
          });
          if (items.length >= Math.max(scanLimit * 3, scanLimit)) {
            break;
          }
        }
        return { matched: true, items };
      }

      if (kind === "tables") {
        const tableNodes: BrowserNodeLike[] = Array.from(rootNode.querySelectorAll?.("table") ?? []);
        const items: ExtractEvalItem[] = [];
        for (const node of tableNodes) {
          if (visibleOnly && !isVisible(node)) {
            continue;
          }
          const caption = normalize(node?.querySelector?.("caption")?.textContent ?? "");
          const rows = Number(node?.querySelectorAll?.("tr")?.length ?? 0);
          const cols = Number(node?.querySelectorAll?.("tr:first-child th, tr:first-child td")?.length ?? 0);
          items.push({
            title: caption.length > 0 ? caption : `table-${items.length + 1}`,
            url: null,
            summary: `rows:${rows} cols:${cols}`,
            publishedAt: null,
            ...(includeActionable
              ? {
                  actionable: {
                    handle: null,
                    selectorHint: selectorHintFor(node),
                    frameId,
                    href: null,
                  },
                }
              : {}),
          });
          if (items.length >= Math.max(scanLimit * 3, scanLimit)) {
            break;
          }
        }
        return { matched: true, items };
      }

      if (kind === "docs-commands") {
        const shellCommandRegex =
          /^(?:\$|#|>)?\s*(npm|pnpm|yarn|npx|bun|pip|pipx|poetry|uv|curl|wget|git|node|python|go|cargo|docker|kubectl|surfwright|zcl)\b/i;
        const commandFromSnippet = (snippet: string): string | null => {
          const lines = snippet
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
          for (const line of lines) {
            const stripped = line.replace(/^(?:\$|#|>)\s*/, "");
            if (shellCommandRegex.test(stripped)) {
              return stripped;
            }
          }
          return null;
        };

        const codeNodes: BrowserNodeLike[] = Array.from(rootNode.querySelectorAll?.("pre code,pre,code") ?? []);
        const items: Array<{
          title: string;
          url: string | null;
          summary: string | null;
          publishedAt: string | null;
          language: string | null;
          command: string | null;
          section: string | null;
          actionable?: {
            handle: string | null;
            selectorHint: string | null;
            frameId: string | null;
            href: string | null;
          };
        }> = [];
        for (const node of codeNodes) {
          if (visibleOnly && !isVisible(node)) {
            continue;
          }
          const snippetRaw = String(node?.innerText ?? node?.textContent ?? "").trim();
          if (snippetRaw.length === 0) {
            continue;
          }
          const command = commandFromSnippet(snippetRaw);
          if (!command) {
            continue;
          }
          const section = sectionFromNode(node);
          const language = languageFromNode(node);
          const actionable = includeActionable
            ? {
                handle: null,
                selectorHint: selectorHintFor(node),
                frameId,
                href: null,
              }
            : undefined;
          items.push({
            title: section ?? command,
            url: null,
            summary: null,
            publishedAt: null,
            language,
            command,
            section,
            actionable,
          });
          if (items.length >= Math.max(scanLimit * 3, scanLimit)) {
            break;
          }
        }
        return { matched: true, items };
      }

      const primarySelectorByKind: Record<TargetExtractReport["kind"], string> = {
        // Heuristic presets should stay interface-shaped (semantic tags/ARIA), not site-shaped classes.
        generic: "article,[role=\"article\"],main a[href]",
        blog: "article,[role=\"article\"]",
        news: "article,[role=\"article\"]",
        docs: "main a[href],nav a[href],article a[href]",
        "docs-commands": "pre code,pre,code",
        headings: "h1,h2,h3,h4,h5,h6",
        links: "a[href]",
        codeblocks: "pre code,pre,code",
        forms: "form",
        tables: "table",
      };
      const primarySelector = primarySelectorByKind[kind];
      const primaryNodes: BrowserNodeLike[] = Array.from(rootNode.querySelectorAll?.(primarySelector) ?? []);
      const fallbackNodes: BrowserNodeLike[] =
        primaryNodes.length > 0 ? [] : Array.from(rootNode.querySelectorAll?.("a[href]") ?? []);
      const nodes: BrowserNodeLike[] = [...primaryNodes, ...fallbackNodes].slice(0, Math.max(scanLimit * 3, scanLimit));
      const items: Array<{
        title: string;
        url: string | null;
        summary: string | null;
        publishedAt: string | null;
        language?: string | null;
        command?: string | null;
        section?: string | null;
        actionable?: {
          handle: string | null;
          selectorHint: string | null;
          frameId: string | null;
          href: string | null;
        };
      }> = [];
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
        const actionable = includeActionable
          ? {
              handle: null,
              selectorHint: selectorHintFor(link ?? node),
              frameId,
              href,
            }
          : undefined;
        items.push({ title, url: href, summary, publishedAt, actionable });
      }
      return { matched: true, items };
    },
    {
      selectorQuery: opts.selectorQuery,
      visibleOnly: opts.visibleOnly,
      kind: opts.kind,
      scanLimit: opts.scanLimit,
      includeActionable: opts.includeActionable,
      frameId: opts.frameId,
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
      language: typeof item.language === "string" ? normalizeExtractWhitespace(item.language) : item.language ?? null,
      command: typeof item.command === "string" ? item.command.trim() : item.command ?? null,
      section: typeof item.section === "string" ? normalizeExtractWhitespace(item.section) : item.section ?? null,
      actionable: item.actionable,
    })),
  };
}
