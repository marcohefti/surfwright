import type { Frame, Page } from "playwright-core";
import { CliError } from "../errors.js";

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

export function framesForScope(page: Page, frameScope: FrameScope): Frame[] {
  if (frameScope === "main") {
    return [page.mainFrame()];
  }
  return page.frames();
}
