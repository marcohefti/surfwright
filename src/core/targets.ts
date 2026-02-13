import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";
import { ensureDefaultManagedSession, ensureSessionReachable } from "./browser.js";
import { CliError } from "./errors.js";
import { nowIso, sanitizeSessionId, updateState, upsertTargetState } from "./state.js";
import { DEFAULT_TARGET_FIND_LIMIT } from "./types.js";
import type { SessionState, TargetFindReport, TargetListReport, TargetSnapshotReport } from "./types.js";

const TARGET_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const SNAPSHOT_TEXT_MAX_CHARS = 1200;
const SNAPSHOT_MAX_HEADINGS = 12;
const SNAPSHOT_MAX_BUTTONS = 12;
const SNAPSHOT_MAX_LINKS = 12;
const FIND_MAX_LIMIT = 50;
const FIND_TEXT_MAX_CHARS = 180;

function stableTargetId(url: string): string {
  let hash = 0x811c9dc5;
  for (const ch of url) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `t${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function sanitizeTargetId(input: string): string {
  const value = input.trim();
  if (!TARGET_ID_PATTERN.test(value)) {
    throw new CliError(
      "E_TARGET_ID_INVALID",
      "targetId may only contain letters, numbers, dot, underscore, colon, and dash",
    );
  }
  return value;
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

async function listPageTargetHandles(
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

async function resolveTargetHandle(
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

function parseFindInput(opts: {
  textQuery?: string;
  selectorQuery?: string;
  limit?: number;
}): {
  mode: "text" | "selector";
  query: string;
  limit: number;
} {
  const textQuery = typeof opts.textQuery === "string" ? opts.textQuery.trim() : "";
  const selectorQuery = typeof opts.selectorQuery === "string" ? opts.selectorQuery.trim() : "";

  const hasText = textQuery.length > 0;
  const hasSelector = selectorQuery.length > 0;
  if (hasText === hasSelector) {
    throw new CliError("E_QUERY_INVALID", "Provide exactly one query: --text <query> or --selector <query>");
  }

  const limitRaw = opts.limit ?? DEFAULT_TARGET_FIND_LIMIT;
  if (!Number.isFinite(limitRaw) || !Number.isInteger(limitRaw) || limitRaw <= 0 || limitRaw > FIND_MAX_LIMIT) {
    throw new CliError("E_QUERY_INVALID", `limit must be an integer between 1 and ${FIND_MAX_LIMIT}`);
  }

  if (hasText) {
    return {
      mode: "text",
      query: textQuery,
      limit: limitRaw,
    };
  }

  return {
    mode: "selector",
    query: selectorQuery,
    limit: limitRaw,
  };
}

async function resolveFindLocator(opts: {
  page: Page;
  mode: "text" | "selector";
  query: string;
}): Promise<{
  locator: Locator;
  count: number;
}> {
  const locator = opts.mode === "text" ? opts.page.getByText(opts.query, { exact: false }) : opts.page.locator(opts.query);

  try {
    const count = await locator.count();
    return { locator, count };
  } catch (error) {
    if (opts.mode === "selector") {
      throw new CliError("E_SELECTOR_INVALID", `Invalid selector query: ${opts.query}`);
    }
    throw error;
  }
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
      await upsertTargetState({
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
}): Promise<TargetSnapshotReport> {
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const { session } = await resolveSessionForAction(opts.sessionId, opts.timeoutMs);
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });

  try {
    const target = (await listPageTargetHandles(browser)).find((handle) => handle.targetId === requestedTargetId);
    if (!target) {
      throw new CliError("E_TARGET_NOT_FOUND", `Target ${requestedTargetId} not found in session ${session.sessionId}`);
    }

    const sample = (await target.page.evaluate(
      ({
        textMaxChars,
        maxHeadings,
        maxButtons,
        maxLinks,
      }: {
        textMaxChars: number;
        maxHeadings: number;
        maxButtons: number;
        maxLinks: number;
      }) => {
        const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
        const runtime = globalThis as unknown as { document?: any };
        const doc = runtime.document;

        const bodyText = normalize(doc?.body?.innerText ?? "");
        const headings = Array.from(doc?.querySelectorAll?.("h1,h2,h3") ?? [])
          .map((node: any) => normalize(node?.textContent ?? ""))
          .filter((value) => value.length > 0);
        const buttons = Array.from(
          doc?.querySelectorAll?.("button,[role=button],input[type=button],input[type=submit],input[type=reset]") ?? [],
        )
          .map((node: any) => {
            const fromText = node?.innerText ?? "";
            const fromAria = node?.getAttribute?.("aria-label") ?? "";
            const fromValue = node?.getAttribute?.("value") ?? "";
            return normalize(fromText || fromAria || fromValue);
          })
          .filter((value) => value.length > 0);
        const links = Array.from(doc?.querySelectorAll?.("a[href]") ?? []).map((node: any) => {
          return {
            text: normalize(node?.textContent ?? ""),
            href: node?.getAttribute?.("href") ?? "",
          };
        });

        return {
          textPreview: bodyText.slice(0, textMaxChars),
          headings: headings.slice(0, maxHeadings),
          buttons: buttons.slice(0, maxButtons),
          links: links.slice(0, maxLinks),
          counts: {
            textLength: bodyText.length,
            headings: headings.length,
            buttons: buttons.length,
            links: links.length,
          },
        };
      },
      {
        textMaxChars: SNAPSHOT_TEXT_MAX_CHARS,
        maxHeadings: SNAPSHOT_MAX_HEADINGS,
        maxButtons: SNAPSHOT_MAX_BUTTONS,
        maxLinks: SNAPSHOT_MAX_LINKS,
      },
    )) as {
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

    const report: TargetSnapshotReport = {
      ok: true,
      sessionId: session.sessionId,
      targetId: requestedTargetId,
      url: target.page.url(),
      title: await target.page.title(),
      textPreview: sample.textPreview,
      headings: sample.headings,
      buttons: sample.buttons,
      links: sample.links,
      truncated: {
        text: sample.counts.textLength > SNAPSHOT_TEXT_MAX_CHARS,
        headings: sample.counts.headings > SNAPSHOT_MAX_HEADINGS,
        buttons: sample.counts.buttons > SNAPSHOT_MAX_BUTTONS,
        links: sample.counts.links > SNAPSHOT_MAX_LINKS,
      },
    };

    await upsertTargetState({
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

export async function targetFind(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  textQuery?: string;
  selectorQuery?: string;
  limit?: number;
}): Promise<TargetFindReport> {
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseFindInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    limit: opts.limit,
  });
  const { session } = await resolveSessionForAction(opts.sessionId, opts.timeoutMs);
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    const { locator, count } = await resolveFindLocator({
      page: target.page,
      mode: parsed.mode,
      query: parsed.query,
    });

    const matches: TargetFindReport["matches"] = [];
    const outputCount = Math.min(count, parsed.limit);
    for (let idx = 0; idx < outputCount; idx += 1) {
      const matchLocator = locator.nth(idx);
      let visible = false;
      let payload: {
        text: string;
        selectorHint: string | null;
      } = {
        text: "",
        selectorHint: null,
      };

      try {
        visible = await matchLocator.isVisible();
      } catch {
        visible = false;
      }

      try {
        payload = (await matchLocator.evaluate(
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
        payload = {
          text: "",
          selectorHint: null,
        };
      }

      matches.push({
        index: idx,
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
      query: parsed.query,
      count,
      limit: parsed.limit,
      matches,
      truncated: count > parsed.limit,
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
