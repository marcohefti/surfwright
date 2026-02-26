import { chromium } from "playwright-core";
import type { Cookie } from "playwright-core";
import { CliError } from "../../errors.js";
import { sanitizeSessionId } from "../../state/index.js";
import { resolveSessionForAction } from "../infra/targets.js";
import type { SessionCookieCopyReport } from "../../types.js";
import { connectSessionBrowser } from "../../session/infra/runtime-access.js";

function parseCookieScopeUrls(rawUrls: string[]): string[] {
  if (!Array.isArray(rawUrls) || rawUrls.length === 0) {
    throw new CliError("E_QUERY_INVALID", "Provide at least one --url scope for cookie copy");
  }
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const rawUrl of rawUrls) {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new CliError("E_URL_INVALID", "URL must be absolute (e.g. https://example.com)");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new CliError("E_URL_INVALID", "URL must use http:// or https://");
    }
    const normalized = parsed.toString();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    urls.push(normalized);
  }
  return urls;
}

function dedupeCookies(cookies: Cookie[]): Cookie[] {
  const byKey = new Map<string, Cookie>();
  for (const cookie of cookies) {
    const key = `${cookie.name}\u0000${cookie.domain}\u0000${cookie.path}`;
    byKey.set(key, cookie);
  }
  return Array.from(byKey.values()).sort((a, b) => {
    const domainCmp = a.domain.localeCompare(b.domain);
    if (domainCmp !== 0) {
      return domainCmp;
    }
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) {
      return nameCmp;
    }
    return a.path.localeCompare(b.path);
  });
}

export async function sessionCookieCopy(opts: {
  fromSessionIdInput: string;
  toSessionIdInput: string;
  urlInputs: string[];
  timeoutMs: number;
}): Promise<SessionCookieCopyReport> {
  const startedAt = Date.now();
  const fromSessionId = sanitizeSessionId(opts.fromSessionIdInput);
  const toSessionId = sanitizeSessionId(opts.toSessionIdInput);
  if (fromSessionId === toSessionId) {
    throw new CliError("E_QUERY_INVALID", "--from-session and --to-session must be different sessions");
  }
  const urls = parseCookieScopeUrls(opts.urlInputs);

  const fromResolved = await resolveSessionForAction({
    sessionHint: fromSessionId,
    timeoutMs: opts.timeoutMs,
    allowImplicitNewSession: false,
  });
  const toResolved = await resolveSessionForAction({
    sessionHint: toSessionId,
    timeoutMs: opts.timeoutMs,
    allowImplicitNewSession: false,
  });
  const sessionsResolvedAt = Date.now();

  const sourceBrowser = await connectSessionBrowser(fromResolved.session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const destinationBrowser = await connectSessionBrowser(toResolved.session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();

  try {
    const sourceContext = sourceBrowser.contexts()[0] ?? (await sourceBrowser.newContext());
    const destinationContext = destinationBrowser.contexts()[0] ?? (await destinationBrowser.newContext());
    const foundCookies = await sourceContext.cookies(urls);
    const importableCookies = dedupeCookies(foundCookies);
    if (importableCookies.length > 0) {
      await destinationContext.addCookies(importableCookies);
    }
    const completedAt = Date.now();

    const uniqueCookieNames = Array.from(new Set(importableCookies.map((cookie) => cookie.name))).sort();
    const uniqueDomains = Array.from(new Set(importableCookies.map((cookie) => cookie.domain))).sort();
    const cookieNamesSample = uniqueCookieNames.slice(0, 12);
    const domainsSample = uniqueDomains.slice(0, 12);

    return {
      ok: true,
      fromSessionId: fromResolved.session.sessionId,
      toSessionId: toResolved.session.sessionId,
      urls,
      counts: {
        found: foundCookies.length,
        imported: importableCookies.length,
        uniqueDomains: uniqueDomains.length,
      },
      sample: {
        cookieNames: cookieNamesSample,
        domains: domainsSample,
        truncated: uniqueCookieNames.length > cookieNamesSample.length || uniqueDomains.length > domainsSample.length,
      },
      timingMs: {
        total: completedAt - startedAt,
        resolveSession: sessionsResolvedAt - startedAt,
        connectCdp: connectedAt - sessionsResolvedAt,
        action: completedAt - connectedAt,
        persistState: 0,
      },
    };
  } finally {
    await Promise.allSettled([sourceBrowser.close(), destinationBrowser.close()]);
  }
}
