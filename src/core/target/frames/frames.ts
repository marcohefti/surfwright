import type { Frame, Page } from "playwright-core";
import { CliError } from "../../errors.js";

export type FrameEntry = {
  frameId: string;
  parentFrameId: string | null;
  depth: number;
  isMain: boolean;
  sameOrigin: boolean;
  url: string;
  name: string | null;
};

function formatFrameId(index: number): string {
  return `f-${index}`;
}

export function parseFrameId(input: string | undefined): number {
  const raw = typeof input === "string" ? input.trim() : "";
  const match = /^f-(\d+)$/.exec(raw);
  if (!match) {
    throw new CliError("E_QUERY_INVALID", "frame-id must match f-<n> (e.g. f-0)");
  }
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new CliError("E_QUERY_INVALID", "frame-id must match f-<n> (e.g. f-0)");
  }
  return value;
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function sortedChildFrames(frame: Frame): Frame[] {
  return frame.childFrames().slice().sort((a, b) => {
    const urlCmp = a.url().localeCompare(b.url());
    if (urlCmp !== 0) {
      return urlCmp;
    }
    const nameA = a.name() ?? "";
    const nameB = b.name() ?? "";
    return nameA.localeCompare(nameB);
  });
}

export function listFrameEntries(page: Page, limit: number): {
  count: number;
  frames: FrameEntry[];
  truncated: boolean;
} {
  const count = page.frames().length;
  const out: FrameEntry[] = [];
  const mainFrame = page.mainFrame();
  const mainOrigin = safeOrigin(mainFrame.url());

  let index = 0;
  const walk = (frame: Frame, parentFrameId: string | null, depth: number) => {
    if (out.length >= limit) {
      return;
    }
    const frameId = formatFrameId(index);
    index += 1;
    const url = frame.url();
    const origin = safeOrigin(url);
    const sameOrigin = mainOrigin !== null && origin !== null && origin === mainOrigin;
    out.push({
      frameId,
      parentFrameId,
      depth,
      isMain: frame === mainFrame,
      sameOrigin,
      url,
      name: frame.name() || null,
    });

    for (const child of sortedChildFrames(frame)) {
      walk(child, frameId, depth + 1);
      if (out.length >= limit) {
        return;
      }
    }
  };

  walk(mainFrame, null, 0);
  return {
    count,
    frames: out,
    truncated: count > out.length,
  };
}

export function resolveFrameById(page: Page, frameIdInput: string | undefined): { frame: Frame; entry: FrameEntry; frameCount: number } {
  const desiredIndex = parseFrameId(frameIdInput);
  const frameCount = page.frames().length;
  const mainFrame = page.mainFrame();
  const mainOrigin = safeOrigin(mainFrame.url());

  let index = 0;

  const walk = (frame: Frame, parentFrameId: string | null, depth: number): { frame: Frame; entry: FrameEntry } | null => {
    const frameId = formatFrameId(index);
    const currentIndex = index;
    index += 1;
    const url = frame.url();
    const origin = safeOrigin(url);
    const sameOrigin = mainOrigin !== null && origin !== null && origin === mainOrigin;
    const entry: FrameEntry = {
      frameId,
      parentFrameId,
      depth,
      isMain: frame === mainFrame,
      sameOrigin,
      url,
      name: frame.name() || null,
    };
    if (currentIndex === desiredIndex) {
      return { frame, entry };
    }
    for (const child of sortedChildFrames(frame)) {
      const childFound = walk(child, frameId, depth + 1);
      if (childFound) {
        return childFound;
      }
    }
    return null;
  };

  const resolved = walk(mainFrame, null, 0);
  if (!resolved) {
    throw new CliError("E_QUERY_INVALID", `frame-id not found: ${formatFrameId(desiredIndex)}`);
  }
  return { frame: resolved.frame, entry: resolved.entry, frameCount };
}
