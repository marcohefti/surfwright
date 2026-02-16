import { CliError } from "../../errors.js";
import type { ManagedBrowserMode } from "../../types.js";

export function parseManagedBrowserMode(input: string | undefined): ManagedBrowserMode | null {
  if (typeof input !== "string") {
    return null;
  }
  const value = input.trim().toLowerCase();
  if (!value) {
    return null;
  }
  if (value === "headless" || value === "headed") {
    return value;
  }
  throw new CliError("E_QUERY_INVALID", "browser-mode must be one of: headless, headed");
}
