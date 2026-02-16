import { chromium } from "playwright-core";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";
import type { TargetUrlAssertReport } from "../../types.js";

function parseOptionalString(input: string | undefined): string | null {
  const value = typeof input === "string" ? input.trim() : "";
  return value.length > 0 ? value : null;
}

function parseOptionalOrigin(input: string | undefined): string | null {
  const value = parseOptionalString(input);
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    throw new CliError("E_QUERY_INVALID", "origin must be absolute (e.g. https://example.com)");
  }
}

function parseOptionalPathPrefix(input: string | undefined): string | null {
  const value = parseOptionalString(input);
  if (!value) {
    return null;
  }
  if (!value.startsWith("/")) {
    throw new CliError("E_QUERY_INVALID", "path-prefix must start with /");
  }
  return value;
}

function matchesPathPrefix(actual: string, expected: string): boolean {
  if (expected === "/") {
    return true;
  }
  if (expected.endsWith("/")) {
    return actual.startsWith(expected);
  }
  return actual === expected || actual.startsWith(`${expected}/`);
}

export async function targetUrlAssert(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  host?: string;
  origin?: string;
  pathPrefix?: string;
  urlPrefix?: string;
}): Promise<TargetUrlAssertReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const host = parseOptionalString(opts.host)?.toLowerCase() ?? null;
  const origin = parseOptionalOrigin(opts.origin);
  const pathPrefix = parseOptionalPathPrefix(opts.pathPrefix);
  const urlPrefix = parseOptionalString(opts.urlPrefix);
  if (!host && !origin && !pathPrefix && !urlPrefix) {
    throw new CliError("E_QUERY_INVALID", "Provide at least one assertion: --host, --origin, --path-prefix, or --url-prefix");
  }

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
    const actualUrl = target.page.url();
    let parsedActual: URL;
    try {
      parsedActual = new URL(actualUrl);
    } catch {
      throw new CliError("E_INTERNAL", "Unable to parse target URL");
    }

    if (host && parsedActual.hostname.toLowerCase() !== host) {
      throw new CliError("E_ASSERT_FAILED", `url-assert failed: host expected ${host} got ${parsedActual.hostname}`);
    }
    if (origin && parsedActual.origin !== origin) {
      throw new CliError("E_ASSERT_FAILED", `url-assert failed: origin expected ${origin} got ${parsedActual.origin}`);
    }
    if (pathPrefix && !matchesPathPrefix(parsedActual.pathname, pathPrefix)) {
      throw new CliError("E_ASSERT_FAILED", `url-assert failed: path-prefix expected ${pathPrefix} got ${parsedActual.pathname}`);
    }
    if (urlPrefix && !actualUrl.startsWith(urlPrefix)) {
      throw new CliError("E_ASSERT_FAILED", `url-assert failed: url-prefix expected ${urlPrefix} got ${actualUrl}`);
    }
    const title = await target.page.title();
    const actionCompletedAt = Date.now();

    const report: TargetUrlAssertReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      url: actualUrl,
      title,
      assert: {
        host,
        origin,
        pathPrefix,
        urlPrefix,
      },
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
