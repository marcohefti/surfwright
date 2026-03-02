import { spawn } from "node:child_process";
import fs from "node:fs";
import net, { AddressInfo } from "node:net";
import path from "node:path";
import { CliError } from "./errors.js";
import {
  CDP_HEALTHCHECK_TIMEOUT_MS,
  isCdpEndpointAlive,
  isCdpEndpointReachable,
} from "./browser/infra/cdp-endpoint.js";
export {
  CDP_HEALTHCHECK_TIMEOUT_MS,
  isCdpEndpointAlive,
  isCdpEndpointReachable,
  normalizeCdpOrigin,
  redactCdpEndpointForDisplay,
  resolveCdpEndpointForAttach,
} from "./browser/infra/cdp-endpoint.js";
import {
  currentAgentId,
  defaultSessionPolicyForKind,
  normalizeSessionPolicy,
  withSessionHeartbeat,
} from "./session/index.js";
import { defaultSessionUserDataDir, nowIso } from "./state/index.js";
import {
  DEFAULT_SESSION_ID,
  type ManagedBrowserMode,
  type SessionPolicy,
  type SessionState,
  type SurfwrightState,
} from "./types.js";
import { resolveManagedExtensionProjection } from "./extensions/index.js";

const CDP_STARTUP_INITIAL_WAIT_MS = 6000;
const CDP_STARTUP_MAX_WAIT_MS = 30000;
const CDP_STARTUP_POLL_MS = 125;
const CDP_STARTUP_RETRY_BACKOFF_MS = 250;
const MANAGED_STARTUP_TERMINATE_GRACE_MS = 500;
const MANAGED_STARTUP_KILL_WAIT_MS = 250;
const EXTENSION_RUNTIME_OBSERVED_WAIT_MS_DEFAULT = 5000;
const EXTENSION_RUNTIME_OBSERVED_WAIT_MS_MAX = 30000;
const EXTENSION_RUNTIME_OBSERVED_POLL_MS = 50;
const EXTENSION_RUNTIME_CDP_PROBE_TIMEOUT_MS = 1500;

type ExtensionRuntimeVerificationMode = "strict" | "warn";

export function managedStartupWaitPlan(timeoutMs: number): {
  firstAttemptStartupWaitMs: number;
  retryAttemptStartupWaitMs: number;
  retryBackoffMs: number;
} {
  const budgetMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : CDP_STARTUP_INITIAL_WAIT_MS;
  return {
    firstAttemptStartupWaitMs: Math.min(budgetMs, CDP_STARTUP_INITIAL_WAIT_MS),
    retryAttemptStartupWaitMs: Math.min(budgetMs, CDP_STARTUP_MAX_WAIT_MS),
    retryBackoffMs: CDP_STARTUP_RETRY_BACKOFF_MS,
  };
}

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

export function buildManagedBrowserArgs(opts: {
  debugPort: number;
  userDataDir: string;
  browserMode: ManagedBrowserMode;
  extensionPaths?: string[];
  platform?: NodeJS.Platform;
  noSandbox?: boolean;
}): string[] {
  const platform = opts.platform ?? process.platform;
  const noSandbox = opts.noSandbox ?? false;
  const args = [
    `--remote-debugging-port=${opts.debugPort}`,
    `--user-data-dir=${opts.userDataDir}`,
    ...(opts.browserMode === "headless" ? ["--headless=new"] : []),
    "--no-first-run",
    "--no-default-browser-check",
  ];
  const extensionPaths = Array.isArray(opts.extensionPaths)
    ? opts.extensionPaths.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    : [];
  if (extensionPaths.length > 0) {
    const csv = extensionPaths.join(",");
    args.push(`--disable-extensions-except=${csv}`);
    args.push(`--load-extension=${csv}`);
  }
  if (platform === "linux") {
    args.push("--disable-dev-shm-usage");
    if (noSandbox) {
      args.push("--no-sandbox", "--disable-setuid-sandbox");
    }
  }
  args.push("about:blank");
  return args;
}

function launchDetachedBrowser(opts: {
  executablePath: string;
  debugPort: number;
  userDataDir: string;
  browserMode: ManagedBrowserMode;
  extensionPaths?: string[];
}): { browserPid: number | null; launchArgs: string[] } {
  const args = buildManagedBrowserArgs({
    debugPort: opts.debugPort,
    userDataDir: opts.userDataDir,
    browserMode: opts.browserMode,
    extensionPaths: opts.extensionPaths,
  });

  try {
    const child = spawn(opts.executablePath, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return { browserPid: child.pid ?? null, launchArgs: args };
  } catch {
    return { browserPid: null, launchArgs: args };
  }
}

function browserStartHints(userDataDir: string): string[] {
  return [
    "Run `surfwright doctor` to verify browser availability and candidates.",
    `Check write access for profile directory: ${userDataDir}`,
    "If parallel runs share state, isolate with SURFWRIGHT_STATE_DIR to avoid contention.",
  ];
}

export function killManagedBrowserProcessTree(browserPid: number | null, signal: "SIGTERM" | "SIGKILL"): void {
  if (typeof browserPid !== "number" || !Number.isFinite(browserPid) || browserPid <= 0) {
    return;
  }
  // Managed sessions launch Chrome detached, so the pid is the process group leader on POSIX.
  // Kill the group first to avoid leaking Chrome helper processes.
  if (process.platform !== "win32") {
    try {
      process.kill(-browserPid, signal);
    } catch {
      // ignore and try the pid directly
    }
  }
  try {
    process.kill(browserPid, signal);
  } catch {
    // Ignore already-exited process cleanup.
  }
}

function terminateBrowserProcess(browserPid: number | null): void {
  killManagedBrowserProcessTree(browserPid, "SIGTERM");
}

function managedBrowserPidAlive(browserPid: number | null): boolean {
  if (typeof browserPid !== "number" || !Number.isFinite(browserPid) || browserPid <= 0) {
    return false;
  }
  try {
    process.kill(browserPid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminateBrowserProcessStrict(browserPid: number | null, graceMs: number): Promise<boolean> {
  if (!managedBrowserPidAlive(browserPid)) {
    return true;
  }
  terminateBrowserProcess(browserPid);
  const termDeadline = Date.now() + Math.max(100, graceMs);
  while (Date.now() < termDeadline) {
    if (!managedBrowserPidAlive(browserPid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!managedBrowserPidAlive(browserPid)) {
    return true;
  }
  killManagedBrowserProcessTree(browserPid, "SIGKILL");
  const killDeadline = Date.now() + MANAGED_STARTUP_KILL_WAIT_MS;
  while (Date.now() < killDeadline) {
    if (!managedBrowserPidAlive(browserPid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !managedBrowserPidAlive(browserPid);
}

const MANAGED_STARTUP_PROFILE_ARTIFACTS = ["DevToolsActivePort", "SingletonLock", "SingletonSocket", "SingletonCookie"];

function cleanupManagedStartupArtifacts(userDataDir: string): void {
  for (const fileName of MANAGED_STARTUP_PROFILE_ARTIFACTS) {
    const artifactPath = path.join(userDataDir, fileName);
    try {
      fs.rmSync(artifactPath, { force: true });
    } catch {
      // Best effort cleanup only.
    }
  }
}

function normalizeFsPathForMatch(input: string): string {
  const normalized = path.resolve(input);
  if (process.platform === "win32") {
    return normalized.toLowerCase();
  }
  return normalized;
}

function readRuntimeInstalledExtensionsByPath(userDataDir: string): {
  installedByPath: Map<string, string>;
  checkedPreferencePaths: string[];
  readablePreferencePaths: string[];
  preferenceRuntimeIds: string[];
} {
  const map = new Map<string, string>();
  const checkedPreferencePaths: string[] = [];
  const readablePreferencePaths: string[] = [];
  const runtimeIds = new Set<string>();
  const prefsCandidates = [
    path.join(userDataDir, "Default", "Secure Preferences"),
    path.join(userDataDir, "Default", "Preferences"),
    path.join(userDataDir, "Secure Preferences"),
    path.join(userDataDir, "Preferences"),
  ];
  for (const prefsPath of prefsCandidates) {
    checkedPreferencePaths.push(prefsPath);
    if (!fs.existsSync(prefsPath)) {
      continue;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(prefsPath, "utf8")) as {
        extensions?: {
          settings?: Record<string, { path?: string }>;
        };
      };
      const settings = parsed?.extensions?.settings;
      if (!settings || typeof settings !== "object") {
        continue;
      }
      readablePreferencePaths.push(prefsPath);
      for (const [runtimeId, raw] of Object.entries(settings)) {
        if (!raw || typeof raw !== "object") {
          continue;
        }
        if (typeof raw.path !== "string" || raw.path.length === 0) {
          continue;
        }
        runtimeIds.add(runtimeId);
        map.set(normalizeFsPathForMatch(raw.path), runtimeId);
      }
    } catch {
      continue;
    }
  }
  return {
    installedByPath: map,
    checkedPreferencePaths,
    readablePreferencePaths,
    preferenceRuntimeIds: Array.from(runtimeIds).sort(),
  };
}

function parsePositiveInt(raw: string | undefined): number | null {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.floor(value);
}

function resolveExtensionRuntimeVerificationMode(): ExtensionRuntimeVerificationMode {
  const raw = process.env.SURFWRIGHT_EXTENSION_RUNTIME_MODE;
  if (typeof raw === "string" && raw.trim().toLowerCase() === "warn") {
    return "warn";
  }
  return "strict";
}

function resolveExtensionRuntimeObservedWaitMs(timeoutMs: number): number {
  const timeoutCap = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : EXTENSION_RUNTIME_OBSERVED_WAIT_MS_DEFAULT;
  const envOverride = parsePositiveInt(process.env.SURFWRIGHT_EXTENSION_RUNTIME_OBSERVED_WAIT_MS);
  const configured = envOverride ?? EXTENSION_RUNTIME_OBSERVED_WAIT_MS_DEFAULT;
  return Math.max(200, Math.min(configured, timeoutCap, EXTENSION_RUNTIME_OBSERVED_WAIT_MS_MAX));
}

function extensionIdFromUrl(rawUrl: string): string | null {
  const match = /^chrome-extension:\/\/([a-p]{32})(?:\/|$)/i.exec(rawUrl.trim());
  if (!match || typeof match[1] !== "string") {
    return null;
  }
  return match[1].toLowerCase();
}

async function inspectExtensionRuntimeTargets(cdpOrigin: string, timeoutMs: number): Promise<{
  cdpRuntimeIds: string[];
  cdpTargetUrls: string[];
}> {
  const controller = new AbortController();
  const deadlineMs = Math.max(200, Math.min(timeoutMs, EXTENSION_RUNTIME_CDP_PROBE_TIMEOUT_MS));
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  try {
    const response = await fetch(`${cdpOrigin.replace(/\/+$/, "")}/json/list`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return { cdpRuntimeIds: [], cdpTargetUrls: [] };
    }
    const payload = (await response.json()) as Array<{ url?: unknown }>;
    if (!Array.isArray(payload)) {
      return { cdpRuntimeIds: [], cdpTargetUrls: [] };
    }
    const cdpTargetUrls: string[] = [];
    const runtimeIds = new Set<string>();
    for (const entry of payload) {
      if (!entry || typeof entry !== "object" || typeof entry.url !== "string") {
        continue;
      }
      const normalizedUrl = entry.url.trim();
      const id = extensionIdFromUrl(normalizedUrl);
      if (!id) {
        continue;
      }
      cdpTargetUrls.push(normalizedUrl);
      runtimeIds.add(id);
    }
    return {
      cdpRuntimeIds: Array.from(runtimeIds).sort(),
      cdpTargetUrls: Array.from(new Set(cdpTargetUrls)).sort(),
    };
  } catch {
    return { cdpRuntimeIds: [], cdpTargetUrls: [] };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveRuntimeAppliedExtensions(opts: {
  userDataDir: string;
  cdpOrigin: string;
  projected: ReturnType<typeof resolveManagedExtensionProjection>["extensions"];
  timeoutMs: number;
}): Promise<{
  appliedExtensions: SessionState["appliedExtensions"];
  diagnostics: {
    checkedPreferencePaths: string[];
    readablePreferencePaths: string[];
    preferenceRuntimeIds: string[];
    cdpRuntimeIds: string[];
    cdpTargetUrls: string[];
    observedWaitMs: number;
    cdpProbeUsed: boolean;
    verificationMode: ExtensionRuntimeVerificationMode;
  };
}> {
  if (opts.projected.length === 0) {
    return {
      appliedExtensions: [],
      diagnostics: {
        checkedPreferencePaths: [],
        readablePreferencePaths: [],
        preferenceRuntimeIds: [],
        cdpRuntimeIds: [],
        cdpTargetUrls: [],
        observedWaitMs: 0,
        cdpProbeUsed: false,
        verificationMode: resolveExtensionRuntimeVerificationMode(),
      },
    };
  }
  const verificationMode = resolveExtensionRuntimeVerificationMode();
  const observedWaitMs = resolveExtensionRuntimeObservedWaitMs(opts.timeoutMs);
  const deadline = Date.now() + observedWaitMs;
  let applied: SessionState["appliedExtensions"] = [];
  let checkedPreferencePaths: string[] = [];
  let readablePreferencePaths: string[] = [];
  let preferenceRuntimeIds: string[] = [];
  while (Date.now() <= deadline) {
    const preferenceObservation = readRuntimeInstalledExtensionsByPath(opts.userDataDir);
    checkedPreferencePaths = preferenceObservation.checkedPreferencePaths;
    readablePreferencePaths = preferenceObservation.readablePreferencePaths;
    preferenceRuntimeIds = preferenceObservation.preferenceRuntimeIds;
    applied = opts.projected.map((entry) => {
      const runtimeId = preferenceObservation.installedByPath.get(normalizeFsPathForMatch(entry.path)) ?? null;
      return {
        id: entry.id,
        name: entry.name,
        version: entry.version,
        path: entry.path,
        manifestVersion: entry.manifestVersion,
        enabled: entry.enabled,
        buildFingerprint: entry.buildFingerprint,
        state: runtimeId ? "runtime-installed" : "registry-only",
        runtimeId,
      };
    });
    if (applied.every((entry) => entry.state === "runtime-installed")) {
      return {
        appliedExtensions: applied,
        diagnostics: {
          checkedPreferencePaths,
          readablePreferencePaths,
          preferenceRuntimeIds,
          cdpRuntimeIds: [],
          cdpTargetUrls: [],
          observedWaitMs,
          cdpProbeUsed: false,
          verificationMode,
        },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, EXTENSION_RUNTIME_OBSERVED_POLL_MS));
  }
  const cdpObservation = await inspectExtensionRuntimeTargets(opts.cdpOrigin, opts.timeoutMs);
  if (cdpObservation.cdpRuntimeIds.length > 0) {
    const unresolved = applied
      .map((entry, index) => ({ entry, index }))
      .filter((item) => item.entry.state !== "runtime-installed");
    const cdpIds = cdpObservation.cdpRuntimeIds;
    if (opts.projected.length === 1 && unresolved.length === 1) {
      const runtimeId = cdpIds[0] ?? null;
      if (runtimeId) {
        applied = applied.map((entry, index) =>
          index !== unresolved[0].index
            ? entry
            : {
                ...entry,
                state: "runtime-installed",
                runtimeId,
              },
        );
      }
    } else if (unresolved.length === opts.projected.length && cdpIds.length >= unresolved.length) {
      applied = applied.map((entry, index) => {
        const unresolvedIndex = unresolved.findIndex((candidate) => candidate.index === index);
        if (unresolvedIndex === -1) {
          return entry;
        }
        return {
          ...entry,
          state: "runtime-installed",
          runtimeId: cdpIds[unresolvedIndex] ?? null,
        };
      });
    }
  }
  return {
    appliedExtensions: applied,
    diagnostics: {
      checkedPreferencePaths,
      readablePreferencePaths,
      preferenceRuntimeIds,
      cdpRuntimeIds: cdpObservation.cdpRuntimeIds,
      cdpTargetUrls: cdpObservation.cdpTargetUrls,
      observedWaitMs,
      cdpProbeUsed: true,
      verificationMode,
    },
  };
}

export async function startManagedSession(
  opts: {
    sessionId: string;
    debugPort: number;
    userDataDir: string;
    browserMode?: ManagedBrowserMode;
    policy?: SessionPolicy;
    profile?: string | null;
    createdAt?: string;
  },
  timeoutMs: number,
): Promise<SessionState> {
  const executablePath = firstChromeExecutablePath();
  if (!executablePath) {
    throw new CliError("E_BROWSER_NOT_FOUND", "No compatible Chrome/Chromium binary found; run doctor for candidates");
  }
  const extensionProjection = resolveManagedExtensionProjection();
  const verificationMode = resolveExtensionRuntimeVerificationMode();

  fs.mkdirSync(opts.userDataDir, { recursive: true });
  const startupPlan = managedStartupWaitPlan(timeoutMs);
  const browserMode: ManagedBrowserMode = opts.browserMode ?? "headless";
  const attemptStart = async (
    debugPort: number,
    startupWaitMs: number,
    startupAttempt: 1 | 2,
  ): Promise<{ browserPid: number; debugPort: number; cdpOrigin: string; launchArgs: string[] }> => {
    const launched = launchDetachedBrowser({
      executablePath,
      debugPort,
      userDataDir: opts.userDataDir,
      browserMode,
      extensionPaths: extensionProjection.loadPaths,
    });
    const browserPid = launched.browserPid;
    if (browserPid === null) {
      throw new CliError("E_BROWSER_START_FAILED", "Failed to spawn Chrome/Chromium process", {
        hints: browserStartHints(opts.userDataDir),
        hintContext: {
          executablePath,
          browserMode,
          debugPort,
          userDataDir: opts.userDataDir,
          launchArgs: launched.launchArgs,
        },
      });
    }
    const cdpOrigin = `http://127.0.0.1:${debugPort}`;
    const isReady = await waitForCdpEndpoint(cdpOrigin, startupWaitMs);
    if (!isReady) {
      const shutdownSucceeded = await terminateBrowserProcessStrict(browserPid, MANAGED_STARTUP_TERMINATE_GRACE_MS);
      throw new CliError("E_BROWSER_START_TIMEOUT", "Browser launched but CDP endpoint did not become ready in time", {
        hints: [
          "Run `surfwright doctor` and confirm the selected browser starts cleanly.",
          "Clear stale session/browser state with `surfwright session clear --timeout-ms 8000` and retry.",
          "If running multiple agents, isolate state per run via SURFWRIGHT_STATE_DIR.",
        ],
        hintContext: {
          cdpOrigin,
          debugPort,
          startupWaitMs,
          startupAttempt,
          browserMode,
          userDataDir: opts.userDataDir,
          shutdownSucceeded,
          launchArgs: launched.launchArgs,
        },
      });
    }
    return { browserPid, debugPort, cdpOrigin, launchArgs: launched.launchArgs };
  };

  let started = await attemptStart(opts.debugPort, startupPlan.firstAttemptStartupWaitMs, 1).catch((error: unknown) => {
    if (!(error instanceof CliError) || error.code !== "E_BROWSER_START_TIMEOUT") {
      throw error;
    }
    return null;
  });
  if (started === null) {
    cleanupManagedStartupArtifacts(opts.userDataDir);
    // Small backoff reduces repeated CDP start races on busy hosts.
    await new Promise((resolve) => setTimeout(resolve, startupPlan.retryBackoffMs));
    started = await attemptStart(await allocateFreePort(), startupPlan.retryAttemptStartupWaitMs, 2);
  }
  try {
    const resolvedExtensions = await resolveRuntimeAppliedExtensions({
      userDataDir: opts.userDataDir,
      cdpOrigin: started.cdpOrigin,
      projected: extensionProjection.extensions,
      timeoutMs,
    });
    const appliedExtensions = resolvedExtensions.appliedExtensions;
    const notInstalled = appliedExtensions.filter((entry) => entry.state !== "runtime-installed");
    if (notInstalled.length > 0 && verificationMode === "strict") {
      throw new CliError("E_EXTENSION_RUNTIME_NOT_LOADED", "Configured extension set was not mounted in runtime", {
        hints: [
          "Confirm each extension path still exists and contains manifest.json plus built assets.",
          "Run `surfwright extension reload <extensionRef>` after rebuilding unpacked extension assets.",
          "Re-run `surfwright open <url> --profile <name>` to force deterministic profile restart.",
        ],
        hintContext: {
          missingExtensionIds: notInstalled.map((entry) => entry.id).join(","),
          missingExtensionNames: notInstalled.map((entry) => entry.name).join(","),
          userDataDir: opts.userDataDir,
          verificationMode,
          launchArgs: started.launchArgs,
          checkedPreferencePaths: resolvedExtensions.diagnostics.checkedPreferencePaths,
          readablePreferencePaths: resolvedExtensions.diagnostics.readablePreferencePaths,
          preferenceRuntimeIds: resolvedExtensions.diagnostics.preferenceRuntimeIds,
          cdpRuntimeIds: resolvedExtensions.diagnostics.cdpRuntimeIds,
          cdpTargetUrls: resolvedExtensions.diagnostics.cdpTargetUrls,
          cdpProbeUsed: resolvedExtensions.diagnostics.cdpProbeUsed,
          observedWaitMs: resolvedExtensions.diagnostics.observedWaitMs,
        },
      });
    }
    const createdAt = opts.createdAt ?? nowIso();
    return withSessionHeartbeat(
      {
        sessionId: opts.sessionId,
        kind: "managed",
        policy: normalizeSessionPolicy(opts.policy) ?? defaultSessionPolicyForKind("managed"),
        browserMode,
        cdpOrigin: started.cdpOrigin,
        debugPort: started.debugPort,
        userDataDir: opts.userDataDir,
        profile: typeof opts.profile === "string" && opts.profile.trim().length > 0 ? opts.profile.trim() : null,
        browserPid: started.browserPid,
        ownerId: currentAgentId(),
        leaseExpiresAt: null,
        leaseTtlMs: null,
        managedUnreachableSince: null,
        managedUnreachableCount: 0,
        extensionSetFingerprint: extensionProjection.extensionSetFingerprint,
        appliedExtensions,
        createdAt,
        lastSeenAt: createdAt,
      },
      createdAt,
    );
  } catch (error) {
    await terminateBrowserProcessStrict(started.browserPid, MANAGED_STARTUP_TERMINATE_GRACE_MS);
    throw error;
  }
}

export async function ensureSessionReachable(
  session: SessionState,
  timeoutMs: number,
  opts?: {
    browserMode?: ManagedBrowserMode;
  },
): Promise<{
  session: SessionState;
  restarted: boolean;
}> {
  const desiredMode = opts?.browserMode;
  const desiredExtensionSetFingerprint = session.kind === "managed" ? resolveManagedExtensionProjection().extensionSetFingerprint : null;
  const extensionDrifted =
    session.kind === "managed" && (session.extensionSetFingerprint ?? null) !== (desiredExtensionSetFingerprint ?? null);
  if (session.kind === "managed" && ((desiredMode && session.browserMode !== desiredMode) || extensionDrifted)) {
    await terminateBrowserProcessStrict(session.browserPid, MANAGED_STARTUP_TERMINATE_GRACE_MS);
    const debugPort = session.debugPort ?? (await allocateFreePort());
    const userDataDir = session.userDataDir ?? defaultSessionUserDataDir(session.sessionId);
    return {
      session: await startManagedSession(
        {
          sessionId: session.sessionId,
          debugPort,
          userDataDir,
          browserMode: desiredMode,
          policy: session.policy,
          profile: session.profile,
          createdAt: session.createdAt,
        },
        timeoutMs,
      ),
      restarted: true,
    };
  }

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
        browserMode: session.kind === "managed" && session.browserMode !== "unknown" ? session.browserMode : undefined,
        policy: session.policy,
        profile: session.profile,
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
  opts?: {
    browserMode?: ManagedBrowserMode;
  },
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

    const ensured = await ensureSessionReachable(existing, timeoutMs, opts);
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
      browserMode: opts?.browserMode,
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
