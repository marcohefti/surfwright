import { chromium, type Locator } from "playwright-core";
import { CliError } from "./errors.js";
import { nowIso, upsertTargetState } from "./state.js";
import { DEFAULT_TARGET_FIND_LIMIT } from "./types.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "./targets.js";
import type { TargetFindReport } from "./types.js";

const FIND_MAX_LIMIT = 50;
const FIND_TEXT_MAX_CHARS = 180;

type ParsedFindInput = {
  mode: "text" | "selector";
  query: string;
  selector: string | null;
  contains: string | null;
  limit: number;
  visibleOnly: boolean;
  first: boolean;
};

function parseFindInput(opts: {
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  limit?: number;
  first?: boolean;
  visibleOnly?: boolean;
}): ParsedFindInput {
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

  const first = Boolean(opts.first);
  const limitRaw = first ? 1 : (opts.limit ?? DEFAULT_TARGET_FIND_LIMIT);
  if (!Number.isFinite(limitRaw) || !Number.isInteger(limitRaw) || limitRaw <= 0 || limitRaw > FIND_MAX_LIMIT) {
    throw new CliError("E_QUERY_INVALID", `limit must be an integer between 1 and ${FIND_MAX_LIMIT}`);
  }

  if (hasSelector) {
    return {
      mode: "selector",
      query: selectorQuery,
      selector: selectorQuery,
      contains: hasContains ? containsQuery : null,
      limit: limitRaw,
      visibleOnly: Boolean(opts.visibleOnly),
      first,
    };
  }

  const textValue = hasText ? textQuery : containsQuery;
  return {
    mode: "text",
    query: textValue,
    selector: null,
    contains: null,
    limit: limitRaw,
    visibleOnly: Boolean(opts.visibleOnly),
    first,
  };
}

async function resolveFindLocator(opts: {
  page: { getByText(query: string, config: { exact: boolean }): Locator; locator(query: string): Locator };
  parsed: ParsedFindInput;
}): Promise<{
  locator: Locator;
  count: number;
}> {
  let locator: Locator;
  if (opts.parsed.mode === "text") {
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
    throw new CliError("E_INTERNAL", "Unable to evaluate find query");
  }
}

async function extractMatchPreview(locator: Locator): Promise<{ text: string; selectorHint: string | null }> {
  try {
    return (await locator.evaluate(
      (node: any, { textMaxChars }: { textMaxChars: number }) => {
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
        textMaxChars: FIND_TEXT_MAX_CHARS,
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

export async function targetFind(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  limit?: number;
  first?: boolean;
  visibleOnly?: boolean;
}): Promise<TargetFindReport> {
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseFindInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    containsQuery: opts.containsQuery,
    limit: opts.limit,
    first: opts.first,
    visibleOnly: opts.visibleOnly,
  });

  const { session } = await resolveSessionForAction(opts.sessionId, opts.timeoutMs);
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    const { locator, count: rawCount } = await resolveFindLocator({
      page: target.page,
      parsed,
    });

    const matches: TargetFindReport["matches"] = [];
    let filteredCount = 0;

    for (let idx = 0; idx < rawCount; idx += 1) {
      const matchLocator = locator.nth(idx);
      let visible = false;
      try {
        visible = await matchLocator.isVisible();
      } catch {
        visible = false;
      }

      if (parsed.visibleOnly && !visible) {
        continue;
      }

      const filteredIndex = filteredCount;
      filteredCount += 1;

      if (matches.length >= parsed.limit) {
        continue;
      }

      const payload = await extractMatchPreview(matchLocator);
      matches.push({
        index: filteredIndex,
        text: payload.text,
        visible,
        selectorHint: payload.selectorHint,
      });
    }

    const report: TargetFindReport = {
      ok: true,
      sessionId: session.sessionId,
      targetId: requestedTargetId,
      mode: parsed.mode,
      selector: parsed.selector,
      contains: parsed.contains,
      visibleOnly: parsed.visibleOnly,
      first: parsed.first,
      query: parsed.query,
      count: filteredCount,
      limit: parsed.limit,
      matches,
      truncated: filteredCount > parsed.limit,
    };

    await upsertTargetState({
      targetId: report.targetId,
      sessionId: report.sessionId,
      url: target.page.url(),
      title: await target.page.title(),
      status: null,
      updatedAt: nowIso(),
    });

    return report;
  } finally {
    await browser.close();
  }
}
