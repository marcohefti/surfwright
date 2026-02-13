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

export function frameScopeHints(opts: {
  frameScope: FrameScope;
  frameCount: number;
  command: "target.read" | "target.snapshot" | "target.extract";
  targetId: string;
}): string[] {
  if (opts.frameCount <= 1 || opts.frameScope !== "main") {
    return [];
  }
  return [
    `Multiple frames detected (${opts.frameCount}). Using main frame only by default.`,
    `To include embedded frames, rerun: surfwright --json ${opts.command} ${opts.targetId} --frame-scope all`,
  ];
}
