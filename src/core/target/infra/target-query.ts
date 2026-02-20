import { type Locator, type Page } from "playwright-core";
import { CliError } from "../../errors.js";
import type { BrowserNodeLike } from "./types/browser-dom-types.js";

const TARGET_QUERY_TEXT_MAX_CHARS = 180;

export type ParsedTargetQuery = {
  mode: "text" | "selector";
  query: string;
  selector: string | null;
  contains: string | null;
  visibleOnly: boolean;
};

export function parseTargetQueryInput(opts: {
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
}): ParsedTargetQuery {
  const textQuery = typeof opts.textQuery === "string" ? opts.textQuery.trim() : "";
  const selectorQuery = typeof opts.selectorQuery === "string" ? opts.selectorQuery.trim() : "";
  const containsQuery = typeof opts.containsQuery === "string" ? opts.containsQuery.trim() : "";

  const hasText = textQuery.length > 0;
  const hasSelector = selectorQuery.length > 0;
  const hasContains = containsQuery.length > 0;

  if (hasText && hasContains) {
    throw new CliError("E_QUERY_INVALID", "Use either --text or --contains, not both");
  }

  if (hasText && hasSelector) {
    throw new CliError("E_QUERY_INVALID", "Use --contains with --selector; --text cannot be combined with --selector");
  }

  if (!hasText && !hasSelector && !hasContains) {
    throw new CliError("E_QUERY_INVALID", "Provide a query via --text, --contains, or --selector");
  }

  if (hasSelector) {
    return {
      mode: "selector",
      query: selectorQuery,
      selector: selectorQuery,
      contains: hasContains ? containsQuery : null,
      visibleOnly: Boolean(opts.visibleOnly),
    };
  }

  return {
    mode: "text",
    query: hasText ? textQuery : containsQuery,
    selector: null,
    contains: null,
    visibleOnly: Boolean(opts.visibleOnly),
  };
}

export async function resolveTargetQueryLocator(opts: {
  page: Page;
  parsed: ParsedTargetQuery;
  preferExactText?: boolean;
}): Promise<{
  locator: Locator;
  count: number;
}> {
  let locator: Locator;
  if (opts.parsed.mode === "text") {
    if (opts.preferExactText) {
      const exactLocator = opts.page.getByText(opts.parsed.query, { exact: true });
      const exactCount = await exactLocator.count();
      if (exactCount > 0) {
        return {
          locator: exactLocator,
          count: exactCount,
        };
      }
    }
    locator = opts.page.getByText(opts.parsed.query, { exact: false });
  } else {
    locator = opts.page.locator(opts.parsed.query);
    if (opts.parsed.contains) {
      locator = locator.filter({ hasText: opts.parsed.contains });
    }
  }

  try {
    const count = await locator.count();
    return { locator, count };
  } catch {
    if (opts.parsed.mode === "selector") {
      throw new CliError("E_SELECTOR_INVALID", `Invalid selector query: ${opts.parsed.query}`);
    }
    throw new CliError("E_INTERNAL", "Unable to evaluate query");
  }
}

export async function extractTargetQueryPreview(locator: Locator): Promise<{ text: string; selectorHint: string | null }> {
  try {
    return (await locator.evaluate(
      (node: BrowserNodeLike, { textMaxChars }: { textMaxChars: number }) => {
        const el = node;
        const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
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
        const selectorHint = tag.length > 0 ? `${tag}${id}${classSuffix}` : null;
        const textCandidate = normalize(el?.innerText ?? el?.textContent ?? "");
        return {
          text: textCandidate.slice(0, textMaxChars),
          selectorHint,
        };
      },
      {
        textMaxChars: TARGET_QUERY_TEXT_MAX_CHARS,
      },
    )) as {
      text: string;
      selectorHint: string | null;
    };
  } catch {
    return {
      text: "",
      selectorHint: null,
    };
  }
}
