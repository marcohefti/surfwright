import { CliError } from "../../errors.js";

export const CDP_HEALTHCHECK_TIMEOUT_MS = 600;
const CDP_HEALTHCHECK_FALLBACK_MAX_TIMEOUT_MS = 3000;
const CDP_DISCOVERY_MIN_TIMEOUT_MS = 200;
const CDP_CONNECT_MIN_TIMEOUT_MS = 200;
const CDP_REACHABILITY_CACHE_TTL_MS = 1200;
const CDP_SENSITIVE_QUERY_KEY = /(token|auth|key|secret|pass|sig|signature)/i;
const cdpReachabilityCache = new Map<string, number>();

async function readJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function boundedHealthcheckTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return CDP_HEALTHCHECK_TIMEOUT_MS;
  }
  return Math.max(CDP_HEALTHCHECK_TIMEOUT_MS, Math.min(Math.floor(timeoutMs), CDP_HEALTHCHECK_FALLBACK_MAX_TIMEOUT_MS));
}

function splitCdpTimeouts(timeoutMs: number): { discoveryTimeoutMs: number; connectTimeoutMs: number } {
  const bounded = boundedHealthcheckTimeout(timeoutMs);
  const discoveryTimeoutMs = Math.max(CDP_DISCOVERY_MIN_TIMEOUT_MS, bounded - CDP_CONNECT_MIN_TIMEOUT_MS);
  const connectTimeoutMs = Math.max(CDP_CONNECT_MIN_TIMEOUT_MS, bounded - discoveryTimeoutMs);
  return {
    discoveryTimeoutMs,
    connectTimeoutMs,
  };
}

function trimTrailingSlash(pathname: string): string {
  if (pathname === "/") {
    return "";
  }
  return pathname.replace(/\/+$/, "");
}

function pushUnique(values: string[], next: string): void {
  if (!values.includes(next)) {
    values.push(next);
  }
}

function discoveryUrlsForHttpEndpoint(input: URL): string[] {
  const urls: string[] = [];
  const origin = input.origin;
  const path = trimTrailingSlash(input.pathname);
  const hasPath = path.length > 0;
  const query = input.search;
  const base = `${origin}${path}${query}`;
  const versionSuffix = "/json/version";

  if (path.endsWith(versionSuffix)) {
    pushUnique(urls, base);
    return urls;
  }

  pushUnique(urls, `${origin}${versionSuffix}${query}`);
  if (hasPath) {
    pushUnique(urls, `${origin}${path}${versionSuffix}${query}`);
    pushUnique(urls, base);
  }
  return urls;
}

function discoveryUrlsForEndpoint(cdpEndpoint: string): string[] {
  const parsed = new URL(cdpEndpoint);
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return discoveryUrlsForHttpEndpoint(parsed);
  }
  const discoveryProtocol = parsed.protocol === "ws:" ? "http:" : "https:";
  const httpUrl = new URL(cdpEndpoint);
  httpUrl.protocol = discoveryProtocol;
  return discoveryUrlsForHttpEndpoint(httpUrl);
}

function normalizeWsEndpoint(rawWsEndpoint: string, discoveryUrl: string): string | null {
  try {
    const parsed = new URL(rawWsEndpoint, discoveryUrl);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

async function discoverCdpWsEndpoint(cdpEndpoint: string, timeoutMs: number): Promise<string | null> {
  const discoveryUrls = discoveryUrlsForEndpoint(cdpEndpoint);
  if (discoveryUrls.length === 0) {
    return null;
  }
  const perRequestTimeoutMs = Math.max(
    CDP_DISCOVERY_MIN_TIMEOUT_MS,
    Math.floor(timeoutMs / Math.max(1, discoveryUrls.length)),
  );
  for (const discoveryUrl of discoveryUrls) {
    const payload = await readJsonWithTimeout(discoveryUrl, perRequestTimeoutMs);
    if (typeof payload !== "object" || payload === null) {
      continue;
    }
    const ws = (payload as { webSocketDebuggerUrl?: unknown }).webSocketDebuggerUrl;
    if (typeof ws !== "string" || ws.length === 0) {
      continue;
    }
    const normalized = normalizeWsEndpoint(ws, discoveryUrl);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

async function isWebSocketEndpointAlive(wsEndpoint: string, timeoutMs: number): Promise<boolean> {
  const WebSocketCtor = globalThis.WebSocket;
  if (typeof WebSocketCtor !== "function") {
    return true;
  }
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let socket: WebSocket | null = null;
    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close(1000, "surfwright-probe-complete");
      } catch {
        // ignore close errors from half-open sockets
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      socket = new WebSocketCtor(wsEndpoint);
    } catch {
      finish(false);
      return;
    }
    socket.onopen = () => finish(true);
    socket.onerror = () => finish(false);
    socket.onclose = () => finish(false);
  });
}

async function resolveCdpConnectEndpoint(cdpEndpoint: string, timeoutMs: number): Promise<string | null> {
  let normalizedEndpoint: string;
  let parsed: URL;
  try {
    normalizedEndpoint = normalizeCdpOrigin(cdpEndpoint);
    parsed = new URL(normalizedEndpoint);
  } catch {
    return null;
  }
  const { discoveryTimeoutMs, connectTimeoutMs } = splitCdpTimeouts(timeoutMs);

  if (parsed.protocol === "ws:" || parsed.protocol === "wss:") {
    if (await isWebSocketEndpointAlive(normalizedEndpoint, connectTimeoutMs)) {
      return normalizedEndpoint;
    }
    const discovered = await discoverCdpWsEndpoint(normalizedEndpoint, discoveryTimeoutMs);
    if (!discovered) {
      return null;
    }
    return (await isWebSocketEndpointAlive(discovered, connectTimeoutMs)) ? discovered : null;
  }

  const discovered = await discoverCdpWsEndpoint(normalizedEndpoint, discoveryTimeoutMs);
  if (!discovered) {
    return null;
  }
  await isWebSocketEndpointAlive(discovered, connectTimeoutMs).catch(() => false);
  return discovered;
}

export async function resolveCdpEndpointForAttach(cdpEndpoint: string, timeoutMs: number): Promise<string | null> {
  return await resolveCdpConnectEndpoint(cdpEndpoint, timeoutMs);
}

export async function isCdpEndpointAlive(cdpOrigin: string, timeoutMs: number): Promise<boolean> {
  return (await resolveCdpConnectEndpoint(cdpOrigin, timeoutMs)) !== null;
}

export async function isCdpEndpointReachable(cdpOrigin: string, timeoutMs: number): Promise<boolean> {
  const cachedAt = cdpReachabilityCache.get(cdpOrigin) ?? 0;
  if (Date.now() - cachedAt <= CDP_REACHABILITY_CACHE_TTL_MS) {
    return true;
  }

  if (await isCdpEndpointAlive(cdpOrigin, CDP_HEALTHCHECK_TIMEOUT_MS)) {
    cdpReachabilityCache.set(cdpOrigin, Date.now());
    return true;
  }

  const fallbackTimeoutMs = boundedHealthcheckTimeout(timeoutMs);
  if (fallbackTimeoutMs <= CDP_HEALTHCHECK_TIMEOUT_MS) {
    cdpReachabilityCache.delete(cdpOrigin);
    return false;
  }
  const reachable = await isCdpEndpointAlive(cdpOrigin, fallbackTimeoutMs);
  if (reachable) {
    cdpReachabilityCache.set(cdpOrigin, Date.now());
  } else {
    cdpReachabilityCache.delete(cdpOrigin);
  }
  return reachable;
}

export function normalizeCdpOrigin(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new CliError("E_CDP_INVALID", "CDP URL must be absolute (e.g. http://127.0.0.1:9222 or ws://127.0.0.1:9222)");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new CliError("E_CDP_INVALID", "CDP URL must use http://, https://, ws://, or wss://");
  }

  if (parsed.username || parsed.password) {
    throw new CliError("E_CDP_INVALID", "CDP URL must not include credentials");
  }

  parsed.hash = "";
  const pathname = trimTrailingSlash(parsed.pathname);
  return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}`;
}

export function redactCdpEndpointForDisplay(cdpEndpoint: string): string {
  try {
    const parsed = new URL(cdpEndpoint);
    parsed.username = "";
    parsed.password = "";
    for (const key of parsed.searchParams.keys()) {
      if (CDP_SENSITIVE_QUERY_KEY.test(key)) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }
    const pathname = trimTrailingSlash(parsed.pathname);
    return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}`;
  } catch {
    return cdpEndpoint;
  }
}
