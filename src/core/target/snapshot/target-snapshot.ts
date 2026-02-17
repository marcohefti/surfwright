import { chromium } from "playwright-core";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import type { TargetSnapshotReport } from "../../types.js";
import { frameScopeHints, parseFrameScope } from "../infra/target-find.js";
import { createCdpEvaluator, ensureValidSelectorSyntaxCdp, frameIdsForScope, getCdpFrameTree, listCdpFrameEntries, openCdpSession } from "../infra/cdp/index.js";
import { normalizeSelectorQuery, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../infra/targets.js";
import { extractScopedSnapshotSample } from "./snapshot-sample.js";
import { safePageTitle } from "../infra/utils/safe-page-title.js";
import { targetSnapshotA11y } from "./snapshot-a11y.js";

type SnapshotMode = "snapshot" | "orient" | "a11y";

const SNAPSHOT_TEXT_MAX_CHARS = 1200;
const SNAPSHOT_MAX_HEADINGS = 12;
const SNAPSHOT_MAX_BUTTONS = 12;
const SNAPSHOT_MAX_LINKS = 12;

const ORIENT_TEXT_MAX_CHARS = 400;
const ORIENT_MAX_HEADINGS = 12;
const ORIENT_MAX_BUTTONS = 0;
const ORIENT_MAX_LINKS = 10;

const SNAPSHOT_MAX_TEXT_CAP = 20000;
const SNAPSHOT_MAX_ITEMS_CAP = 200;
const SNAPSHOT_MAX_AX_ROWS_DEFAULT = 60;
const SNAPSHOT_MAX_AX_ROWS_CAP = 200;

type SnapshotCursor = {
  headings: number;
  buttons: number;
  links: number;
  ax: number;
};

function parseSnapshotMode(input: string | undefined): SnapshotMode {
  if (typeof input === "undefined") {
    return "snapshot";
  }
  const normalized = input.trim().toLowerCase();
  if (normalized === "snapshot" || normalized === "orient" || normalized === "a11y") {
    return normalized;
  }
  throw new CliError("E_QUERY_INVALID", "mode must be one of: snapshot, orient, a11y");
}

function parseNonNegativeIntInRange(opts: {
  value: number | undefined;
  defaultValue: number;
  min: number;
  max: number;
  name: string;
}): number {
  if (typeof opts.value === "undefined") {
    return opts.defaultValue;
  }
  if (!Number.isFinite(opts.value) || !Number.isInteger(opts.value) || opts.value < opts.min || opts.value > opts.max) {
    throw new CliError("E_QUERY_INVALID", `${opts.name} must be an integer between ${opts.min} and ${opts.max}`);
  }
  return opts.value;
}

function parseSnapshotCursor(input: string | undefined): SnapshotCursor {
  if (typeof input === "undefined") {
    return { headings: 0, buttons: 0, links: 0, ax: 0 };
  }
  const raw = input.trim();
  if (raw.length === 0) {
    throw new CliError("E_QUERY_INVALID", "cursor must not be empty");
  }

  const parsed: Partial<SnapshotCursor> = {};
  const parts = raw.split(";").map((part) => part.trim());
  for (const part of parts) {
    if (part.length === 0) {
      continue;
    }
    const [keyRaw, valueRaw] = part.split("=");
    const key = (keyRaw ?? "").trim().toLowerCase();
    const valueText = (valueRaw ?? "").trim();
    const value = Number.parseInt(valueText, 10);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new CliError("E_QUERY_INVALID", "cursor offsets must be non-negative integers");
    }
    if (key === "h") parsed.headings = value;
    else if (key === "b") parsed.buttons = value;
    else if (key === "l") parsed.links = value;
    else if (key === "ax") parsed.ax = value;
    else throw new CliError("E_QUERY_INVALID", "cursor keys must be: h, b, l, ax");
  }

  return {
    headings: parsed.headings ?? 0,
    buttons: parsed.buttons ?? 0,
    links: parsed.links ?? 0,
    ax: parsed.ax ?? 0,
  };
}

function formatSnapshotCursor(cursor: SnapshotCursor): string {
  return `h=${cursor.headings};b=${cursor.buttons};l=${cursor.links}`;
}

export async function targetSnapshot(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  selectorQuery?: string;
  visibleOnly?: boolean;
  frameScope?: string;
  mode?: string;
  cursor?: string;
  includeSelectorHints?: boolean;
  maxChars?: number;
  maxHeadings?: number;
  maxButtons?: number;
  maxLinks?: number;
  maxAxRows?: number;
}): Promise<TargetSnapshotReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const selectorQuery = normalizeSelectorQuery(opts.selectorQuery);
  const visibleOnly = Boolean(opts.visibleOnly);
  const frameScope = parseFrameScope(opts.frameScope);
  const mode = parseSnapshotMode(opts.mode);
  const cursor = parseSnapshotCursor(opts.cursor);
  const includeSelectorHints = Boolean(opts.includeSelectorHints);

  const textMaxChars = parseNonNegativeIntInRange({
    value: opts.maxChars,
    defaultValue: mode === "orient" ? ORIENT_TEXT_MAX_CHARS : SNAPSHOT_TEXT_MAX_CHARS,
    min: 0,
    max: SNAPSHOT_MAX_TEXT_CAP,
    name: "max-chars",
  });
  const maxHeadings = parseNonNegativeIntInRange({
    value: opts.maxHeadings,
    defaultValue: mode === "orient" ? ORIENT_MAX_HEADINGS : SNAPSHOT_MAX_HEADINGS,
    min: 0,
    max: SNAPSHOT_MAX_ITEMS_CAP,
    name: "max-headings",
  });
  const maxButtons = parseNonNegativeIntInRange({
    value: opts.maxButtons,
    defaultValue: mode === "orient" ? ORIENT_MAX_BUTTONS : SNAPSHOT_MAX_BUTTONS,
    min: 0,
    max: SNAPSHOT_MAX_ITEMS_CAP,
    name: "max-buttons",
  });
  const maxLinks = parseNonNegativeIntInRange({
    value: opts.maxLinks,
    defaultValue: mode === "orient" ? ORIENT_MAX_LINKS : SNAPSHOT_MAX_LINKS,
    min: 0,
    max: SNAPSHOT_MAX_ITEMS_CAP,
    name: "max-links",
  });
  const maxAxRows = parseNonNegativeIntInRange({
    value: opts.maxAxRows,
    defaultValue: SNAPSHOT_MAX_AX_ROWS_DEFAULT,
    min: 0,
    max: SNAPSHOT_MAX_AX_ROWS_CAP,
    name: "max-ax-rows",
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
    const cdp = await openCdpSession(target.page);
    const frameTree = await getCdpFrameTree(cdp);
    const frameCount = listCdpFrameEntries({ frameTree, limit: 1 }).count;
    const frameIds = frameIdsForScope({ frameTree, scope: frameScope });
    const hints = frameScopeHints({
      frameScope,
      frameCount,
      command: "target.snapshot",
      targetId: requestedTargetId,
    });
    const worldCache = new Map<string, number>();
    if (selectorQuery) {
      await ensureValidSelectorSyntaxCdp({
        cdp,
        frameCdpId: frameTree.frame.id,
        worldCache,
        selectorQuery,
      });
    }

    if (mode === "a11y") {
      if (cursor.headings !== 0 || cursor.buttons !== 0 || cursor.links !== 0) {
        throw new CliError("E_QUERY_INVALID", "a11y cursor must use ax=<n> (e.g. ax=0)");
      }
      return await targetSnapshotA11y({
        startedAt,
        resolvedSessionAt,
        connectedAt,
        timeoutMs: opts.timeoutMs,
        sessionId: session.sessionId,
        sessionSource,
        targetId: requestedTargetId,
        page: target.page,
        cdp,
        selectorQuery,
        visibleOnly,
        frameScope,
        cursorTokenProvided: Boolean(opts.cursor),
        cursorAx: cursor.ax,
        maxAxRows,
        hints,
        persistState: opts.persistState !== false,
      });
    }

    const cursorHeadings = cursor.headings;
    const cursorButtons = cursor.buttons;
    const cursorLinks = cursor.links;

    let skipHeadings = cursorHeadings;
    let skipButtons = cursorButtons;
    let skipLinks = cursorLinks;

    let scopeMatched = false;
    let totalTextLength = 0;
    let totalHeadings = 0;
    let totalButtons = 0;
    let totalLinks = 0;
    const headings: string[] = [];
    const headingSelectorHints: Array<string | null> = [];
    const buttons: string[] = [];
    const buttonSelectorHints: Array<string | null> = [];
    const links: Array<{ text: string; href: string }> = [];
    const linkSelectorHints: Array<string | null> = [];
    let textPreview = "";
    let h1: string | null = null;

    for (const frameCdpId of frameIds) {
      const evaluator = createCdpEvaluator({
        cdp,
        frameCdpId,
        worldCache,
      });
      const remainingText = Math.max(0, textMaxChars - textPreview.length);
      const remainingHeadings = Math.max(0, maxHeadings - headings.length);
      const remainingButtons = Math.max(0, maxButtons - buttons.length);
      const remainingLinks = Math.max(0, maxLinks - links.length);

      const sample = await extractScopedSnapshotSample({
        evaluator,
        selectorQuery,
        visibleOnly,
        mode,
        textMaxChars: Math.max(0, remainingText),
        maxHeadings: Math.max(0, remainingHeadings),
        maxButtons: Math.max(0, remainingButtons),
        maxLinks: Math.max(0, remainingLinks),
        skipHeadings,
        skipButtons,
        skipLinks,
        includeSelectorHints,
      });

      scopeMatched = scopeMatched || sample.scopeMatched;
      totalTextLength += sample.counts.textLength;
      totalHeadings += sample.counts.headings;
      totalButtons += sample.counts.buttons;
      totalLinks += sample.counts.links;

      skipHeadings = Math.max(0, skipHeadings - sample.counts.headings);
      skipButtons = Math.max(0, skipButtons - sample.counts.buttons);
      skipLinks = Math.max(0, skipLinks - sample.counts.links);

      if (mode === "orient" && h1 === null && typeof sample.h1 === "string" && sample.h1.length > 0) {
        h1 = sample.h1;
      }

      if (remainingText > 0 && sample.textPreview.length > 0) {
        textPreview = `${textPreview}${textPreview.length > 0 ? "\n" : ""}${sample.textPreview}`.slice(0, textMaxChars);
      }

      if (remainingHeadings > 0 && sample.headings.length > 0) {
        headings.push(...sample.headings.slice(0, remainingHeadings));
        if (includeSelectorHints && sample.selectorHints) {
          headingSelectorHints.push(...sample.selectorHints.headings.slice(0, remainingHeadings));
        }
      }

      if (remainingButtons > 0 && sample.buttons.length > 0) {
        buttons.push(...sample.buttons.slice(0, remainingButtons));
        if (includeSelectorHints && sample.selectorHints) {
          buttonSelectorHints.push(...sample.selectorHints.buttons.slice(0, remainingButtons));
        }
      }

      if (remainingLinks > 0 && sample.links.length > 0) {
        links.push(...sample.links.slice(0, remainingLinks));
        if (includeSelectorHints && sample.selectorHints) {
          linkSelectorHints.push(...sample.selectorHints.links.slice(0, remainingLinks));
        }
      }
    }
    const actionCompletedAt = Date.now();

    const truncated = {
      text: totalTextLength > textMaxChars,
      headings: maxHeadings > 0 && totalHeadings > cursorHeadings + headings.length,
      buttons: maxButtons > 0 && totalButtons > cursorButtons + buttons.length,
      links: maxLinks > 0 && totalLinks > cursorLinks + links.length,
    };

    const hasNextCursor = truncated.headings || truncated.buttons || truncated.links;
    const nextCursor = hasNextCursor
      ? formatSnapshotCursor({
          headings: cursorHeadings + headings.length,
          buttons: cursorButtons + buttons.length,
          links: cursorLinks + links.length,
          ax: 0,
        })
      : null;

    const report: TargetSnapshotReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      mode,
      cursor: opts.cursor ? formatSnapshotCursor(cursor) : null,
      nextCursor,
      url: target.page.url(),
      title: await safePageTitle(target.page, opts.timeoutMs),
      scope: {
        selector: selectorQuery,
        matched: scopeMatched,
        visibleOnly,
        frameScope,
      },
      textPreview,
      headings,
      buttons,
      links,
      truncated,
      hints,
      timingMs: {
        total: 0,
        resolveSession: resolvedSessionAt - startedAt,
        connectCdp: connectedAt - resolvedSessionAt,
        action: actionCompletedAt - connectedAt,
        persistState: 0,
      },
    };

    if (mode === "orient") {
      report.h1 = h1;
    }

    if (includeSelectorHints) {
      report.items = {
        headings: headings.map((text, idx) => ({
          index: cursorHeadings + idx,
          text,
          selectorHint: headingSelectorHints[idx] ?? null,
        })),
        buttons: buttons.map((text, idx) => ({
          index: cursorButtons + idx,
          text,
          selectorHint: buttonSelectorHints[idx] ?? null,
        })),
        links: links.map((link, idx) => ({
          index: cursorLinks + idx,
          text: link.text,
          href: link.href,
          selectorHint: linkSelectorHints[idx] ?? null,
        })),
      };
    }

    const persistStartedAt = Date.now();
    if (opts.persistState !== false) {
      await saveTargetSnapshot({
        targetId: report.targetId,
        sessionId: report.sessionId,
        url: report.url,
        title: report.title,
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
