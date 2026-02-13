import type { Page } from "playwright-core";

export async function extractScopedSnapshotSample(opts: {
  page: Page;
  selectorQuery: string | null;
  visibleOnly: boolean;
  textMaxChars: number;
  maxHeadings: number;
  maxButtons: number;
  maxLinks: number;
}): Promise<{
  scopeMatched: boolean;
  textPreview: string;
  headings: string[];
  buttons: string[];
  links: Array<{ text: string; href: string }>;
  counts: {
    textLength: number;
    headings: number;
    buttons: number;
    links: number;
  };
}> {
  return (await opts.page.evaluate(
    ({ selectorQuery, visibleOnly, textMaxChars, maxHeadings, maxButtons, maxLinks }) => {
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
          scopeMatched: false,
          textPreview: "",
          headings: [],
          buttons: [],
          links: [],
          counts: {
            textLength: 0,
            headings: 0,
            buttons: 0,
            links: 0,
          },
        };
      }

      const textRaw = visibleOnly ? rootNode?.innerText ?? "" : rootNode?.textContent ?? "";
      const normalizedText = normalize(textRaw);

      const headingNodes = Array.from(rootNode.querySelectorAll?.("h1,h2,h3") ?? []);
      const buttonNodes = Array.from(
        rootNode.querySelectorAll?.("button,[role=button],input[type=button],input[type=submit],input[type=reset]") ?? [],
      );
      const linkNodes = Array.from(rootNode.querySelectorAll?.("a[href]") ?? []);

      const headings = headingNodes
        .filter((node: any) => (visibleOnly ? isVisible(node) : true))
        .map((node: any) => normalize(node?.textContent ?? ""))
        .filter((value: string) => value.length > 0);

      const buttons = buttonNodes
        .filter((node: any) => (visibleOnly ? isVisible(node) : true))
        .map((node: any) => {
          const fromText = node?.innerText ?? "";
          const fromAria = node?.getAttribute?.("aria-label") ?? "";
          const fromValue = node?.getAttribute?.("value") ?? "";
          return normalize(fromText || fromAria || fromValue);
        })
        .filter((value: string) => value.length > 0);

      const links = linkNodes
        .filter((node: any) => (visibleOnly ? isVisible(node) : true))
        .map((node: any) => ({
          text: normalize(node?.textContent ?? ""),
          href: node?.getAttribute?.("href") ?? "",
        }));

      return {
        scopeMatched: true,
        textPreview: normalizedText.slice(0, textMaxChars),
        headings: headings.slice(0, maxHeadings),
        buttons: buttons.slice(0, maxButtons),
        links: links.slice(0, maxLinks),
        counts: {
          textLength: normalizedText.length,
          headings: headings.length,
          buttons: buttons.length,
          links: links.length,
        },
      };
    },
    {
      selectorQuery: opts.selectorQuery,
      visibleOnly: opts.visibleOnly,
      textMaxChars: opts.textMaxChars,
      maxHeadings: opts.maxHeadings,
      maxButtons: opts.maxButtons,
      maxLinks: opts.maxLinks,
    },
  )) as {
    scopeMatched: boolean;
    textPreview: string;
    headings: string[];
    buttons: string[];
    links: Array<{ text: string; href: string }>;
    counts: {
      textLength: number;
      headings: number;
      buttons: number;
      links: number;
    };
  };
}
