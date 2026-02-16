import fs from "node:fs";
import path from "node:path";
import { chromium, type Frame, type Locator, type Page } from "playwright-core";
import { newActionId } from "../action-id.js";
import { CliError } from "../errors.js";
import { nowIso } from "../state/index.js";
import { saveTargetSnapshot } from "../state/index.js";
import { extractTargetQueryPreview, parseTargetQueryInput, resolveTargetQueryLocator } from "./target-query.js";
import { DEFAULT_TARGET_FIND_LIMIT } from "../types.js";
import { ensureValidSelector, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "./targets.js";
import type { TargetFindReport } from "../types.js";

const FIND_MAX_LIMIT = 50;

type ParsedFindInput = {
  query: ReturnType<typeof parseTargetQueryInput>;
  limit: number;
  first: boolean;
};

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

type TargetDragDropReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  actionId: string;
  from: string;
  to: string;
  result: "dragged";
  timingMs: {
    total: number;
    resolveSession: number;
    connectCdp: number;
    action: number;
    persistState: number;
  };
};

type TargetUploadReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  actionId: string;
  selector: string;
  files: Array<{
    name: string;
    size: number;
    type: string;
  }>;
  fileCount: number;
  mode: "direct-input" | "filechooser";
  timingMs: {
    total: number;
    resolveSession: number;
    connectCdp: number;
    action: number;
    persistState: number;
  };
};

function parseFindInput(opts: {
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  limit?: number;
  first?: boolean;
  visibleOnly?: boolean;
}): ParsedFindInput {
  const first = Boolean(opts.first);
  const limitRaw = first ? 1 : (opts.limit ?? DEFAULT_TARGET_FIND_LIMIT);
  if (!Number.isFinite(limitRaw) || !Number.isInteger(limitRaw) || limitRaw <= 0 || limitRaw > FIND_MAX_LIMIT) {
    throw new CliError("E_QUERY_INVALID", `limit must be an integer between 1 and ${FIND_MAX_LIMIT}`);
  }

  return {
    query: parseTargetQueryInput({
      textQuery: opts.textQuery,
      selectorQuery: opts.selectorQuery,
      containsQuery: opts.containsQuery,
      visibleOnly: opts.visibleOnly,
    }),
    limit: limitRaw,
    first,
  };
}

function parseRequiredSelector(input: string | undefined, optionName: string): string {
  const selector = typeof input === "string" ? input.trim() : "";
  if (selector.length === 0) {
    throw new CliError("E_QUERY_INVALID", `${optionName} selector is required`);
  }
  return selector;
}

function mimeFromName(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  if (ext === ".gif") {
    return "image/gif";
  }
  if (ext === ".pdf") {
    return "application/pdf";
  }
  if (ext === ".json") {
    return "application/json";
  }
  if (ext === ".txt") {
    return "text/plain";
  }
  if (ext === ".csv") {
    return "text/csv";
  }
  return "application/octet-stream";
}

function parseUploadFiles(input: string | string[] | undefined): Array<{ absolutePath: string; name: string; size: number; type: string }> {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? [input]
      : [];
  const files = raw.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (files.length === 0) {
    throw new CliError("E_QUERY_INVALID", "Provide at least one --file <path>");
  }

  return files.map((filePath) => {
    const absolutePath = path.resolve(filePath);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolutePath);
    } catch {
      throw new CliError("E_QUERY_INVALID", `file is not readable: ${filePath}`);
    }
    if (!stat.isFile()) {
      throw new CliError("E_QUERY_INVALID", `file must point to a regular file: ${filePath}`);
    }
    return {
      absolutePath,
      name: path.basename(absolutePath),
      size: stat.size,
      type: mimeFromName(path.basename(absolutePath)),
    };
  });
}

export async function targetFind(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  limit?: number;
  first?: boolean;
  visibleOnly?: boolean;
}): Promise<TargetFindReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseFindInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    containsQuery: opts.containsQuery,
    limit: opts.limit,
    first: opts.first,
    visibleOnly: opts.visibleOnly,
  });

  const { session, sessionSource } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: requestedTargetId,
  });
  const resolvedSessionAt = Date.now();
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    const { locator, count: rawCount } = await resolveTargetQueryLocator({
      page: target.page,
      parsed: parsed.query,
    });

    const matches: TargetFindReport["matches"] = [];
    let filteredCount = 0;

    for (let idx = 0; idx < rawCount; idx += 1) {
      const matchLocator: Locator = locator.nth(idx);
      let visible = false;
      try {
        visible = await matchLocator.isVisible();
      } catch {
        visible = false;
      }

      if (parsed.query.visibleOnly && !visible) {
        continue;
      }

      const filteredIndex = filteredCount;
      filteredCount += 1;

      if (matches.length >= parsed.limit) {
        continue;
      }

      const payload = await extractTargetQueryPreview(matchLocator);
      matches.push({
        index: filteredIndex,
        text: payload.text,
        visible,
        selectorHint: payload.selectorHint,
      });
    }
    const actionCompletedAt = Date.now();

    const report: TargetFindReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      mode: parsed.query.mode,
      selector: parsed.query.selector,
      contains: parsed.query.contains,
      visibleOnly: parsed.query.visibleOnly,
      first: parsed.first,
      query: parsed.query.query,
      count: filteredCount,
      limit: parsed.limit,
      matches,
      truncated: filteredCount > parsed.limit,
      timingMs: {
        total: 0,
        resolveSession: resolvedSessionAt - startedAt,
        connectCdp: connectedAt - resolvedSessionAt,
        action: actionCompletedAt - connectedAt,
        persistState: 0,
      },
    };

    const persistStartedAt = Date.now();
    if (opts.persistState !== false) {
      await saveTargetSnapshot({
        targetId: report.targetId,
        sessionId: report.sessionId,
        url: target.page.url(),
        title: await target.page.title(),
        status: null,
        updatedAt: nowIso(),
      });
    }
    const persistedAt = Date.now();
    report.timingMs.persistState = persistedAt - persistStartedAt;
    report.timingMs.total = persistedAt - startedAt;

    return report;
  } finally {
    await browser.close();
  }
}

export async function targetDragDrop(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  fromSelector?: string;
  toSelector?: string;
}): Promise<TargetDragDropReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const fromSelector = parseRequiredSelector(opts.fromSelector, "from");
  const toSelector = parseRequiredSelector(opts.toSelector, "to");

  const { session } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: requestedTargetId,
  });
  const resolvedSessionAt = Date.now();
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    await ensureValidSelector(target.page, fromSelector);
    await ensureValidSelector(target.page, toSelector);

    const fromCount = await target.page.locator(fromSelector).count();
    if (fromCount < 1) {
      throw new CliError("E_QUERY_INVALID", `No element matched source selector: ${fromSelector}`);
    }
    const toCount = await target.page.locator(toSelector).count();
    if (toCount < 1) {
      throw new CliError("E_QUERY_INVALID", `No element matched destination selector: ${toSelector}`);
    }

    await target.page.dragAndDrop(fromSelector, toSelector, {
      timeout: opts.timeoutMs,
    });
    const actionCompletedAt = Date.now();

    const report: TargetDragDropReport = {
      ok: true,
      sessionId: session.sessionId,
      targetId: requestedTargetId,
      actionId: newActionId(),
      from: fromSelector,
      to: toSelector,
      result: "dragged",
      timingMs: {
        total: 0,
        resolveSession: resolvedSessionAt - startedAt,
        connectCdp: connectedAt - resolvedSessionAt,
        action: actionCompletedAt - connectedAt,
        persistState: 0,
      },
    };

    const persistStartedAt = Date.now();
    if (opts.persistState !== false) {
      await saveTargetSnapshot({
        targetId: report.targetId,
        sessionId: report.sessionId,
        url: target.page.url(),
        title: await target.page.title(),
        status: null,
        lastActionId: report.actionId,
        lastActionAt: nowIso(),
        lastActionKind: "drag-drop",
        updatedAt: nowIso(),
      });
    }
    const persistedAt = Date.now();
    report.timingMs.persistState = persistedAt - persistStartedAt;
    report.timingMs.total = persistedAt - startedAt;
    return report;
  } finally {
    await browser.close();
  }
}

export async function targetUpload(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  selectorQuery?: string;
  files?: string | string[];
}): Promise<TargetUploadReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const selector = parseRequiredSelector(opts.selectorQuery, "selector");
  const fileInputs = parseUploadFiles(opts.files);

  const { session } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: requestedTargetId,
  });
  const resolvedSessionAt = Date.now();
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    await ensureValidSelector(target.page, selector);
    const locator = target.page.locator(selector).first();
    const count = await target.page.locator(selector).count();
    if (count < 1) {
      throw new CliError("E_QUERY_INVALID", `No element matched upload selector: ${selector}`);
    }

    const absolutePaths = fileInputs.map((entry) => entry.absolutePath);
    const isFileInput = await locator.evaluate((node: any) => {
      const tagName = typeof node?.tagName === "string" ? node.tagName.toLowerCase() : "";
      const inputType = typeof node?.type === "string" ? node.type.toLowerCase() : "";
      return tagName === "input" && inputType === "file";
    });

    let mode: TargetUploadReport["mode"] = "direct-input";
    if (isFileInput) {
      await locator.setInputFiles(absolutePaths, {
        timeout: opts.timeoutMs,
      });
    } else {
      mode = "filechooser";
      const chooserPromise = target.page.waitForEvent("filechooser", {
        timeout: opts.timeoutMs,
      });
      await locator.click({
        timeout: opts.timeoutMs,
      });
      let chooser: { setFiles(files: string[], options?: { timeout?: number }): Promise<void> };
      try {
        chooser = await chooserPromise;
      } catch {
        throw new CliError("E_QUERY_INVALID", "selector did not trigger a file chooser");
      }
      await chooser.setFiles(absolutePaths, {
        timeout: opts.timeoutMs,
      });
    }

    const actionCompletedAt = Date.now();
    const report: TargetUploadReport = {
      ok: true,
      sessionId: session.sessionId,
      targetId: requestedTargetId,
      actionId: newActionId(),
      selector,
      files: fileInputs.map(({ name, size, type }) => ({ name, size, type })),
      fileCount: fileInputs.length,
      mode,
      timingMs: {
        total: 0,
        resolveSession: resolvedSessionAt - startedAt,
        connectCdp: connectedAt - resolvedSessionAt,
        action: actionCompletedAt - connectedAt,
        persistState: 0,
      },
    };

    const persistStartedAt = Date.now();
    if (opts.persistState !== false) {
      await saveTargetSnapshot({
        targetId: report.targetId,
        sessionId: report.sessionId,
        url: target.page.url(),
        title: await target.page.title(),
        status: null,
        lastActionId: report.actionId,
        lastActionAt: nowIso(),
        lastActionKind: "upload",
        updatedAt: nowIso(),
      });
    }
    const persistedAt = Date.now();
    report.timingMs.persistState = persistedAt - persistStartedAt;
    report.timingMs.total = persistedAt - startedAt;
    return report;
  } finally {
    await browser.close();
  }
}
