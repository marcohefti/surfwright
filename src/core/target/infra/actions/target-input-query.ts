import type { Locator } from "playwright-core";
import { CliError } from "../../../errors.js";
import { parseTargetQueryInput } from "../target-query.js";

export function parseOptionalTargetQuery(opts: {
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
}): ReturnType<typeof parseTargetQueryInput> | null {
  const selectedCount =
    Number(typeof opts.textQuery === "string" && opts.textQuery.trim().length > 0) +
    Number(typeof opts.selectorQuery === "string" && opts.selectorQuery.trim().length > 0) +
    Number(typeof opts.containsQuery === "string" && opts.containsQuery.trim().length > 0);
  if (selectedCount === 0) {
    return null;
  }
  return parseTargetQueryInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    containsQuery: opts.containsQuery,
    visibleOnly: opts.visibleOnly,
  });
}

export async function resolveFirstQueryMatch(opts: {
  locator: Locator;
  count: number;
  visibleOnly: boolean;
}): Promise<Locator> {
  for (let idx = 0; idx < opts.count; idx += 1) {
    const candidate = opts.locator.nth(idx);
    let visible = false;
    try {
      visible = await candidate.isVisible();
    } catch {
      visible = false;
    }

    if (opts.visibleOnly && !visible) {
      continue;
    }
    return candidate;
  }
  throw new CliError(
    "E_QUERY_INVALID",
    opts.visibleOnly ? "No visible element matched query" : "No element matched query",
  );
}

