import type { Locator } from "playwright-core";
import { CliError } from "../../errors.js";

export async function resolveFirstMatch(opts: {
  locator: Locator;
  count: number;
  visibleOnly: boolean;
}): Promise<{
  locator: Locator;
  index: number;
  visible: boolean;
}> {
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
    return {
      locator: candidate,
      index: idx,
      visible,
    };
  }
  throw new CliError("E_QUERY_INVALID", opts.visibleOnly ? "No visible element matched query" : "No element matched query");
}
