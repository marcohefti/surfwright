export async function extractScopedSnapshotSample(opts: {
  evaluator: {
    evaluate<T, Arg>(pageFunction: (arg: Arg) => T, arg: Arg): Promise<T>;
  };
  selectorQuery: string | null;
  visibleOnly: boolean;
  mode: "snapshot" | "orient";
  textMaxChars: number;
  maxHeadings: number;
  maxButtons: number;
  maxLinks: number;
  skipHeadings: number;
  skipButtons: number;
  skipLinks: number;
  includeSelectorHints: boolean;
}): Promise<{
  scopeMatched: boolean;
  h1: string | null;
  textPreview: string;
  headings: string[];
  buttons: string[];
  links: Array<{ text: string; href: string }>;
  selectorHints: {
    headings: Array<string | null>;
    buttons: Array<string | null>;
    links: Array<string | null>;
  } | null;
  counts: {
    textLength: number;
    headings: number;
    buttons: number;
    links: number;
  };
}> {
  return (await opts.evaluator.evaluate(
    ({
      selectorQuery,
      visibleOnly,
      mode,
      textMaxChars,
      maxHeadings,
      maxButtons,
      maxLinks,
      skipHeadings,
      skipButtons,
      skipLinks,
      includeSelectorHints,
    }) => {
      const runtime = globalThis as unknown as { document?: any; getComputedStyle?: any };
      const doc = runtime.document;
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const selectorHintFor = (node: any): string | null => {
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
          h1: null,
          textPreview: "",
          headings: [],
          buttons: [],
          links: [],
          selectorHints: includeSelectorHints
            ? {
                headings: [],
                buttons: [],
                links: [],
              }
            : null,
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

      const h1Node = mode === "orient" ? rootNode.querySelector?.("h1") ?? null : null;
      const h1Text = mode === "orient" && h1Node ? normalize(h1Node?.textContent ?? "") : "";
      const h1 = h1Text.length > 0 ? h1Text : null;

      const headingEntries = Array.from(rootNode.querySelectorAll?.("h1,h2,h3") ?? [])
        .filter((node: any) => (visibleOnly ? isVisible(node) : true))
        .map((node: any) => ({
          text: normalize(node?.textContent ?? ""),
          selectorHint: includeSelectorHints ? selectorHintFor(node) : null,
        }))
        .filter((entry: { text: string }) => entry.text.length > 0);

      const buttonEntries = Array.from(
        rootNode.querySelectorAll?.("button,[role=button],input[type=button],input[type=submit],input[type=reset]") ?? [],
      )
        .filter((node: any) => (visibleOnly ? isVisible(node) : true))
        .map((node: any) => {
          const fromText = node?.innerText ?? "";
          const fromAria = node?.getAttribute?.("aria-label") ?? "";
          const fromValue = node?.getAttribute?.("value") ?? "";
          return {
            text: normalize(fromText || fromAria || fromValue),
            selectorHint: includeSelectorHints ? selectorHintFor(node) : null,
          };
        })
        .filter((entry: { text: string }) => entry.text.length > 0);

      const linkRoot =
        mode === "orient" ? rootNode.querySelector?.("header") ?? rootNode.querySelector?.("nav") ?? rootNode : rootNode;
      const rawLinkEntries = Array.from(linkRoot?.querySelectorAll?.("a[href]") ?? [])
        .filter((node: any) => (visibleOnly ? isVisible(node) : true))
        .map((node: any) => ({
          text: normalize(node?.textContent ?? ""),
          href: node?.getAttribute?.("href") ?? "",
          selectorHint: includeSelectorHints ? selectorHintFor(node) : null,
        }))
        .filter((entry: { text: string }) => entry.text.length > 0);

      const linkEntries: Array<{ text: string; href: string; selectorHint: string | null }> = [];
      const seen = new Set<string>();
      for (const entry of rawLinkEntries) {
        const key = `${entry.text}\n${entry.href}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        if (mode === "orient") {
          const textLower = entry.text.toLowerCase();
          if (textLower.startsWith("skip")) {
            continue;
          }
          if (entry.text.length > 60) {
            continue;
          }
        }
        linkEntries.push(entry);
      }

      const pageHeadings = headingEntries.slice(skipHeadings, skipHeadings + maxHeadings);
      const pageButtons = buttonEntries.slice(skipButtons, skipButtons + maxButtons);
      const pageLinks = linkEntries.slice(skipLinks, skipLinks + maxLinks);

      return {
        scopeMatched: true,
        h1,
        textPreview: normalizedText.slice(0, textMaxChars),
        headings: pageHeadings.map((entry) => entry.text),
        buttons: pageButtons.map((entry) => entry.text),
        links: pageLinks.map((entry) => ({ text: entry.text, href: entry.href })),
        selectorHints: includeSelectorHints
          ? {
              headings: pageHeadings.map((entry) => entry.selectorHint),
              buttons: pageButtons.map((entry) => entry.selectorHint),
              links: pageLinks.map((entry) => entry.selectorHint),
            }
          : null,
        counts: {
          textLength: normalizedText.length,
          headings: headingEntries.length,
          buttons: buttonEntries.length,
          links: linkEntries.length,
        },
      };
    },
    {
      selectorQuery: opts.selectorQuery,
      visibleOnly: opts.visibleOnly,
      mode: opts.mode,
      textMaxChars: opts.textMaxChars,
      maxHeadings: opts.maxHeadings,
      maxButtons: opts.maxButtons,
      maxLinks: opts.maxLinks,
      skipHeadings: opts.skipHeadings,
      skipButtons: opts.skipButtons,
      skipLinks: opts.skipLinks,
      includeSelectorHints: opts.includeSelectorHints,
    },
  )) as {
    scopeMatched: boolean;
    h1: string | null;
    textPreview: string;
    headings: string[];
    buttons: string[];
    links: Array<{ text: string; href: string }>;
    selectorHints: {
      headings: Array<string | null>;
      buttons: Array<string | null>;
      links: Array<string | null>;
    } | null;
    counts: {
      textLength: number;
      headings: number;
      buttons: number;
      links: number;
    };
  };
}
