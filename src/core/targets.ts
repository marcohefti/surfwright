import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { ensureDefaultManagedSession, ensureSessionReachable } from "./browser.js";
import { CliError } from "./errors.js";
import { nowIso, sanitizeSessionId, updateState } from "./state.js";
import { saveTargetSnapshot } from "./state-repos/target-repo.js";
import type { SessionState, TargetListReport, TargetSnapshotReport } from "./types.js";

const TARGET_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const SNAPSHOT_TEXT_MAX_CHARS = 1200;
const SNAPSHOT_MAX_HEADINGS = 12;
const SNAPSHOT_MAX_BUTTONS = 12;
const SNAPSHOT_MAX_LINKS = 12;
const SNAPSHOT_MAX_TEXT_CAP = 20000;
const SNAPSHOT_MAX_ITEMS_CAP = 200;

function stableTargetId(url: string): string {
  let hash = 0x811c9dc5;
  for (const ch of url) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `t${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function parsePositiveIntInRange(opts: {
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

export function sanitizeTargetId(input: string): string {
  const value = input.trim();
  if (!TARGET_ID_PATTERN.test(value)) {
    throw new CliError(
      "E_TARGET_ID_INVALID",
      "targetId may only contain letters, numbers, dot, underscore, colon, and dash",
    );
  }
  return value;
}

export function normalizeSelectorQuery(input: string | undefined): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const value = input.trim();
  if (value.length === 0) {
    throw new CliError("E_QUERY_INVALID", "selector query must not be empty");
  }
  return value;
}

export async function ensureValidSelector(page: Page, selectorQuery: string): Promise<void> {
  try {
    await page.locator(selectorQuery).count();
  } catch {
    throw new CliError("E_SELECTOR_INVALID", `Invalid selector query: ${selectorQuery}`);
  }
}

export async function resolveSessionForAction(
  sessionHint: string | undefined,
  timeoutMs: number,
): Promise<{
  session: SessionState;
}> {
  return await updateState(async (state) => {
    if (typeof sessionHint === "string" && sessionHint.length > 0) {
      const sessionId = sanitizeSessionId(sessionHint);
      const existing = state.sessions[sessionId];
      if (!existing) {
        throw new CliError("E_SESSION_NOT_FOUND", `Session ${sessionId} not found`);
      }

      const ensured = await ensureSessionReachable(existing, timeoutMs);
      state.sessions[sessionId] = ensured.session;
      return { session: ensured.session };
    }

    if (state.activeSessionId && state.sessions[state.activeSessionId]) {
      const active = state.sessions[state.activeSessionId];
      const ensured = await ensureSessionReachable(active, timeoutMs);
      state.sessions[state.activeSessionId] = ensured.session;
      return { session: ensured.session };
    }

    const ensuredDefault = await ensureDefaultManagedSession(state, timeoutMs);
    state.activeSessionId = ensuredDefault.session.sessionId;
    return { session: ensuredDefault.session };
  });
}

export async function readPageTargetId(context: BrowserContext, page: Page): Promise<string> {
  try {
    const cdpSession = await context.newCDPSession(page);
    const targetInfo = (await cdpSession.send("Target.getTargetInfo")) as {
      targetInfo?: { targetId?: string };
    };
    return targetInfo.targetInfo?.targetId ?? stableTargetId(page.url());
  } catch {
    return stableTargetId(page.url());
  }
}

export async function listPageTargetHandles(
  browser: Browser,
): Promise<
  Array<{
    page: Page;
    targetId: string;
  }>
> {
  const handles: Array<{
    page: Page;
    targetId: string;
  }> = [];

  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      handles.push({
        page,
        targetId: await readPageTargetId(context, page),
      });
    }
  }

  return handles;
}

export async function resolveTargetHandle(
  browser: Browser,
  targetId: string,
): Promise<{
  page: Page;
  targetId: string;
}> {
  const target = (await listPageTargetHandles(browser)).find((handle) => handle.targetId === targetId);
  if (!target) {
    throw new CliError("E_TARGET_NOT_FOUND", `Target ${targetId} not found in session`);
  }
  return target;
}

async function extractScopedSnapshotSample(opts: {
  page: Page;
  selectorQuery: string | null;
  visibleOnly: boolean;
  textMaxChars: number;
  maxHeadings: number;
  maxButtons: number;
  maxLinks: number;
}): Promise<{
  scopeMatched: boolean;
  textPreview: string;
  headings: string[];
  buttons: string[];
  links: Array<{ text: string; href: string }>;
  counts: {
    textLength: number;
    headings: number;
    buttons: number;
    links: number;
  };
}> {
  return (await opts.page.evaluate(
    ({ selectorQuery, visibleOnly, textMaxChars, maxHeadings, maxButtons, maxLinks }) => {
      const runtime = globalThis as unknown as { document?: any; getComputedStyle?: any };
      const doc = runtime.document;
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const isVisible = (node: any): boolean => {
        if (!node) {
          return false;
        }
        if (node.hasAttribute?.("hidden")) {
          return false;
        }
        const style = runtime.getComputedStyle?.(node);
        if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) {
          return false;
        }
        return (node.getClientRects?.().length ?? 0) > 0;
      };

      const rootNode = selectorQuery ? doc?.querySelector?.(selectorQuery) ?? null : doc?.body ?? null;
      if (!rootNode) {
        return {
          scopeMatched: false,
          textPreview: "",
          headings: [],
          buttons: [],
          links: [],
          counts: {
            textLength: 0,
            headings: 0,
            buttons: 0,
            links: 0,
          },
        };
      }

      const textRaw = visibleOnly ? rootNode?.innerText ?? "" : rootNode?.textContent ?? "";
      const normalizedText = normalize(textRaw);

      const headingNodes = Array.from(rootNode.querySelectorAll?.("h1,h2,h3") ?? []);
      const buttonNodes = Array.from(
        rootNode.querySelectorAll?.("button,[role=button],input[type=button],input[type=submit],input[type=reset]") ?? [],
      );
      const linkNodes = Array.from(rootNode.querySelectorAll?.("a[href]") ?? []);

      const headings = headingNodes
        .filter((node: any) => (visibleOnly ? isVisible(node) : true))
        .map((node: any) => normalize(node?.textContent ?? ""))
        .filter((value: string) => value.length > 0);

      const buttons = buttonNodes
        .filter((node: any) => (visibleOnly ? isVisible(node) : true))
        .map((node: any) => {
          const fromText = node?.innerText ?? "";
          const fromAria = node?.getAttribute?.("aria-label") ?? "";
          const fromValue = node?.getAttribute?.("value") ?? "";
          return normalize(fromText || fromAria || fromValue);
        })
        .filter((value: string) => value.length > 0);

      const links = linkNodes
        .filter((node: any) => (visibleOnly ? isVisible(node) : true))
        .map((node: any) => ({
          text: normalize(node?.textContent ?? ""),
          href: node?.getAttribute?.("href") ?? "",
        }));

      return {
        scopeMatched: true,
        textPreview: normalizedText.slice(0, textMaxChars),
        headings: headings.slice(0, maxHeadings),
        buttons: buttons.slice(0, maxButtons),
        links: links.slice(0, maxLinks),
        counts: {
          textLength: normalizedText.length,
          headings: headings.length,
          buttons: buttons.length,
          links: links.length,
        },
      };
    },
    {
      selectorQuery: opts.selectorQuery,
      visibleOnly: opts.visibleOnly,
      textMaxChars: opts.textMaxChars,
      maxHeadings: opts.maxHeadings,
      maxButtons: opts.maxButtons,
      maxLinks: opts.maxLinks,
    },
  )) as {
    scopeMatched: boolean;
    textPreview: string;
    headings: string[];
    buttons: string[];
    links: Array<{ text: string; href: string }>;
    counts: {
      textLength: number;
      headings: number;
      buttons: number;
      links: number;
    };
  };
}

export async function targetList(opts: { timeoutMs: number; sessionId?: string }): Promise<TargetListReport> {
  const { session } = await resolveSessionForAction(opts.sessionId, opts.timeoutMs);
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });

  try {
    const handles = await listPageTargetHandles(browser);
    const targets: TargetListReport["targets"] = [];
    for (const handle of handles) {
      targets.push({
        targetId: handle.targetId,
        url: handle.page.url(),
        title: await handle.page.title(),
        type: "page",
      });
    }
    targets.sort((a, b) => a.targetId.localeCompare(b.targetId));

    for (const target of targets) {
      await saveTargetSnapshot({
        targetId: target.targetId,
        sessionId: session.sessionId,
        url: target.url,
        title: target.title,
        status: null,
        updatedAt: nowIso(),
      });
    }

    return {
      ok: true,
      sessionId: session.sessionId,
      targets,
    };
  } finally {
    await browser.close();
  }
}

export async function targetSnapshot(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  selectorQuery?: string;
  visibleOnly?: boolean;
  maxChars?: number;
  maxHeadings?: number;
  maxButtons?: number;
  maxLinks?: number;
}): Promise<TargetSnapshotReport> {
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const selectorQuery = normalizeSelectorQuery(opts.selectorQuery);
  const visibleOnly = Boolean(opts.visibleOnly);
  const textMaxChars = parsePositiveIntInRange({
    value: opts.maxChars,
    defaultValue: SNAPSHOT_TEXT_MAX_CHARS,
    min: 1,
    max: SNAPSHOT_MAX_TEXT_CAP,
    name: "max-chars",
  });
  const maxHeadings = parsePositiveIntInRange({
    value: opts.maxHeadings,
    defaultValue: SNAPSHOT_MAX_HEADINGS,
    min: 1,
    max: SNAPSHOT_MAX_ITEMS_CAP,
    name: "max-headings",
  });
  const maxButtons = parsePositiveIntInRange({
    value: opts.maxButtons,
    defaultValue: SNAPSHOT_MAX_BUTTONS,
    min: 1,
    max: SNAPSHOT_MAX_ITEMS_CAP,
    name: "max-buttons",
  });
  const maxLinks = parsePositiveIntInRange({
    value: opts.maxLinks,
    defaultValue: SNAPSHOT_MAX_LINKS,
    min: 1,
    max: SNAPSHOT_MAX_ITEMS_CAP,
    name: "max-links",
  });

  const { session } = await resolveSessionForAction(opts.sessionId, opts.timeoutMs);
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    if (selectorQuery) {
      await ensureValidSelector(target.page, selectorQuery);
    }

    const sample = await extractScopedSnapshotSample({
      page: target.page,
      selectorQuery,
      visibleOnly,
      textMaxChars,
      maxHeadings,
      maxButtons,
      maxLinks,
    });

    const report: TargetSnapshotReport = {
      ok: true,
      sessionId: session.sessionId,
      targetId: requestedTargetId,
      url: target.page.url(),
      title: await target.page.title(),
      scope: {
        selector: selectorQuery,
        matched: sample.scopeMatched,
        visibleOnly,
      },
      textPreview: sample.textPreview,
      headings: sample.headings,
      buttons: sample.buttons,
      links: sample.links,
      truncated: {
        text: sample.counts.textLength > textMaxChars,
        headings: sample.counts.headings > maxHeadings,
        buttons: sample.counts.buttons > maxButtons,
        links: sample.counts.links > maxLinks,
      },
    };

    await saveTargetSnapshot({
      targetId: report.targetId,
      sessionId: report.sessionId,
      url: report.url,
      title: report.title,
      status: null,
      updatedAt: nowIso(),
    });

    return report;
  } finally {
    await browser.close();
  }
}
