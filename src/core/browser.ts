import { spawn } from "node:child_process";
import fs from "node:fs";
import net, { AddressInfo } from "node:net";
import { CliError } from "./errors.js";
import {
  currentAgentId,
  defaultSessionPolicyForKind,
  normalizeSessionPolicy,
  withSessionHeartbeat,
} from "./session/hygiene.js";
import { defaultSessionUserDataDir, nowIso } from "./state.js";
import { DEFAULT_SESSION_ID, type SessionPolicy, type SessionState, type SurfwrightState } from "./types.js";

export const CDP_HEALTHCHECK_TIMEOUT_MS = 600;
const CDP_HEALTHCHECK_FALLBACK_MAX_TIMEOUT_MS = 3000;
const CDP_STARTUP_MAX_WAIT_MS = 6000;
const CDP_STARTUP_POLL_MS = 125;

export function chromeCandidatesForPlatform(): string[] {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }

  if (process.platform === "win32") {
    return [
      "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
      "C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
      "C:\\\\Program Files\\\\Chromium\\\\Application\\\\chrome.exe",
      "C:\\\\Program Files\\\\BraveSoftware\\\\Brave-Browser\\\\Application\\\\brave.exe",
      "C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe",
    ];
  }

  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/brave-browser",
    "/usr/bin/microsoft-edge",
  ];
}

function firstChromeExecutablePath(): string | null {
  const candidates = chromeCandidatesForPlatform();
  for (const candidatePath of candidates) {
    try {
      if (fs.existsSync(candidatePath)) {
        return candidatePath;
      }
    } catch {
      continue;
    }
  }
  return null;
}

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

export async function isCdpEndpointAlive(cdpOrigin: string, timeoutMs: number): Promise<boolean> {
  const payload = await readJsonWithTimeout(`${cdpOrigin}/json/version`, timeoutMs);
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const ws = (payload as { webSocketDebuggerUrl?: unknown }).webSocketDebuggerUrl;
  return typeof ws === "string" && ws.length > 0;
}

function boundedHealthcheckTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return CDP_HEALTHCHECK_TIMEOUT_MS;
  }
  return Math.max(CDP_HEALTHCHECK_TIMEOUT_MS, Math.min(Math.floor(timeoutMs), CDP_HEALTHCHECK_FALLBACK_MAX_TIMEOUT_MS));
}

export async function isCdpEndpointReachable(cdpOrigin: string, timeoutMs: number): Promise<boolean> {
  if (await isCdpEndpointAlive(cdpOrigin, CDP_HEALTHCHECK_TIMEOUT_MS)) {
    return true;
  }

  const fallbackTimeoutMs = boundedHealthcheckTimeout(timeoutMs);
  if (fallbackTimeoutMs <= CDP_HEALTHCHECK_TIMEOUT_MS) {
    return false;
  }
  return await isCdpEndpointAlive(cdpOrigin, fallbackTimeoutMs);
}

async function waitForCdpEndpoint(cdpOrigin: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isCdpEndpointAlive(cdpOrigin, CDP_HEALTHCHECK_TIMEOUT_MS)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, CDP_STARTUP_POLL_MS));
  }
  return false;
}

export function normalizeCdpOrigin(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new CliError("E_CDP_INVALID", "CDP URL must be absolute (e.g. http://127.0.0.1:9222)");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CliError("E_CDP_INVALID", "CDP URL must use http:// or https://");
  }

  if (parsed.username || parsed.password) {
    throw new CliError("E_CDP_INVALID", "CDP URL must not include credentials");
  }

  return parsed.origin;
}

export async function allocateFreePort(): Promise<number> {
  const server = net.createServer();

  return await new Promise<number>((resolve, reject) => {
    server.once("error", (error) => reject(error));
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address() as AddressInfo | string | null;
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate local port"));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function launchDetachedBrowser(opts: { executablePath: string; debugPort: number; userDataDir: string }): number | null {
  const args = [
    `--remote-debugging-port=${opts.debugPort}`,
    `--user-data-dir=${opts.userDataDir}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ];

  try {
    const child = spawn(opts.executablePath, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}

function terminateBrowserProcess(browserPid: number | null): void {
  if (typeof browserPid !== "number" || !Number.isFinite(browserPid) || browserPid <= 0) {
    return;
  }
  try {
    process.kill(browserPid, "SIGTERM");
  } catch {
    // Ignore already-exited process cleanup.
  }
}

export async function startManagedSession(
  opts: {
    sessionId: string;
    debugPort: number;
    userDataDir: string;
    policy?: SessionPolicy;
    createdAt?: string;
  },
  timeoutMs: number,
): Promise<SessionState> {
  const executablePath = firstChromeExecutablePath();
  if (!executablePath) {
    throw new CliError("E_BROWSER_NOT_FOUND", "No compatible Chrome/Chromium binary found; run doctor for candidates");
  }

  fs.mkdirSync(opts.userDataDir, { recursive: true });
  const startupWaitMs = Math.min(timeoutMs, CDP_STARTUP_MAX_WAIT_MS);
  const attemptStart = async (debugPort: number): Promise<{ browserPid: number; debugPort: number; cdpOrigin: string }> => {
    const browserPid = launchDetachedBrowser({
      executablePath,
      debugPort,
      userDataDir: opts.userDataDir,
    });
    if (browserPid === null) {
      throw new CliError("E_BROWSER_START_FAILED", "Failed to spawn Chrome/Chromium process");
    }
    const cdpOrigin = `http://127.0.0.1:${debugPort}`;
    const isReady = await waitForCdpEndpoint(cdpOrigin, startupWaitMs);
    if (!isReady) {
      terminateBrowserProcess(browserPid);
      throw new CliError("E_BROWSER_START_TIMEOUT", "Browser launched but CDP endpoint did not become ready in time");
    }
    return { browserPid, debugPort, cdpOrigin };
  };

  let started = await attemptStart(opts.debugPort).catch((error: unknown) => {
    if (!(error instanceof CliError) || error.code !== "E_BROWSER_START_TIMEOUT") {
      throw error;
    }
    return null;
  });
  if (started === null) {
    started = await attemptStart(await allocateFreePort());
  }

  const createdAt = opts.createdAt ?? nowIso();
  return withSessionHeartbeat(
    {
      sessionId: opts.sessionId,
      kind: "managed",
      policy: normalizeSessionPolicy(opts.policy) ?? defaultSessionPolicyForKind("managed"),
      cdpOrigin: started.cdpOrigin,
      debugPort: started.debugPort,
      userDataDir: opts.userDataDir,
      browserPid: started.browserPid,
      ownerId: currentAgentId(),
      leaseExpiresAt: null,
      leaseTtlMs: null,
      managedUnreachableSince: null,
      managedUnreachableCount: 0,
      createdAt,
      lastSeenAt: createdAt,
    },
    createdAt,
  );
}

export async function ensureSessionReachable(
  session: SessionState,
  timeoutMs: number,
): Promise<{
  session: SessionState;
  restarted: boolean;
}> {
  if (await isCdpEndpointReachable(session.cdpOrigin, timeoutMs)) {
    return {
      session: withSessionHeartbeat(session),
      restarted: false,
    };
  }

  if (session.kind === "attached") {
    throw new CliError(
      "E_SESSION_UNREACHABLE",
      `Attached session ${session.sessionId} is not reachable; re-run session attach explicitly`,
    );
  }

  const debugPort = session.debugPort ?? (await allocateFreePort());
  const userDataDir = session.userDataDir ?? defaultSessionUserDataDir(session.sessionId);

  return {
    session: await startManagedSession(
      {
        sessionId: session.sessionId,
        debugPort,
        userDataDir,
        policy: session.policy,
        createdAt: session.createdAt,
      },
      timeoutMs,
    ),
    restarted: true,
  };
}

export async function ensureDefaultManagedSession(
  state: SurfwrightState,
  timeoutMs: number,
): Promise<{
  session: SessionState;
  created: boolean;
  restarted: boolean;
}> {
  const existing = state.sessions[DEFAULT_SESSION_ID];

  if (existing) {
    if (existing.kind !== "managed") {
      throw new CliError("E_SESSION_CONFLICT", `Reserved session ${DEFAULT_SESSION_ID} is not managed`);
    }

    const ensured = await ensureSessionReachable(existing, timeoutMs);
    state.sessions[DEFAULT_SESSION_ID] = ensured.session;
    return {
      session: ensured.session,
      created: false,
      restarted: ensured.restarted,
    };
  }

  const debugPort = await allocateFreePort();
  const userDataDir = defaultSessionUserDataDir(DEFAULT_SESSION_ID);
  const created = await startManagedSession(
    {
      sessionId: DEFAULT_SESSION_ID,
      debugPort,
      userDataDir,
      policy: "persistent",
      createdAt: nowIso(),
    },
    timeoutMs,
  );
  state.sessions[DEFAULT_SESSION_ID] = created;

  return {
    session: created,
    created: true,
    restarted: false,
  };
}
