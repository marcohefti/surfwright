import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { CliError } from "./errors.js";
import { STATE_VERSION, type SessionKind, type SessionState, type SurfwrightState, type TargetState } from "./types.js";

const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const STATE_LOCK_FILENAME = "state.lock";
const STATE_LOCK_RETRY_MS = 40;
const STATE_LOCK_TIMEOUT_MS = 12000;
const STATE_LOCK_STALE_MS = 20000;

export function stateRootDir(): string {
  const fromEnv = process.env.SURFWRIGHT_STATE_DIR;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv.trim());
  }
  return path.join(os.homedir(), ".surfwright");
}

export function stateFilePath(): string {
  return path.join(stateRootDir(), "state.json");
}

function stateLockFilePath(): string {
  return path.join(stateRootDir(), STATE_LOCK_FILENAME);
}

export function defaultSessionUserDataDir(sessionId: string): string {
  return path.join(stateRootDir(), "profiles", sessionId);
}

function emptyState(): SurfwrightState {
  return {
    version: STATE_VERSION,
    activeSessionId: null,
    nextSessionOrdinal: 1,
    sessions: {},
    targets: {},
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function asPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const n = Math.floor(value);
  if (n <= 0) {
    return null;
  }
  return n;
}

export function inferDebugPortFromCdpOrigin(cdpOrigin: string): number | null {
  try {
    const parsed = new URL(cdpOrigin);
    if (!parsed.port) {
      return null;
    }
    const port = Number.parseInt(parsed.port, 10);
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function normalizeSession(sessionId: string, raw: unknown): SessionState | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const value = raw as {
    kind?: unknown;
    cdpOrigin?: unknown;
    debugPort?: unknown;
    userDataDir?: unknown;
    browserPid?: unknown;
    createdAt?: unknown;
    lastSeenAt?: unknown;
  };

  if (typeof value.cdpOrigin !== "string" || value.cdpOrigin.length === 0) {
    return null;
  }

  const kind: SessionKind = value.kind === "attached" ? "attached" : "managed";
  const debugPort = asPositiveInteger(value.debugPort) ?? inferDebugPortFromCdpOrigin(value.cdpOrigin);
  const userDataDir =
    kind === "managed"
      ? typeof value.userDataDir === "string" && value.userDataDir.length > 0
        ? value.userDataDir
        : defaultSessionUserDataDir(sessionId)
      : null;
  const browserPid = asPositiveInteger(value.browserPid);

  return {
    sessionId,
    kind,
    cdpOrigin: value.cdpOrigin,
    debugPort,
    userDataDir,
    browserPid,
    createdAt: typeof value.createdAt === "string" && value.createdAt.length > 0 ? value.createdAt : nowIso(),
    lastSeenAt: typeof value.lastSeenAt === "string" && value.lastSeenAt.length > 0 ? value.lastSeenAt : nowIso(),
  };
}

function normalizeTarget(raw: unknown): TargetState | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const value = raw as {
    targetId?: unknown;
    sessionId?: unknown;
    url?: unknown;
    title?: unknown;
    status?: unknown;
    updatedAt?: unknown;
  };

  if (
    typeof value.targetId !== "string" ||
    typeof value.sessionId !== "string" ||
    typeof value.url !== "string" ||
    typeof value.title !== "string"
  ) {
    return null;
  }

  const status = typeof value.status === "number" && Number.isFinite(value.status) ? value.status : null;

  return {
    targetId: value.targetId,
    sessionId: value.sessionId,
    url: value.url,
    title: value.title,
    status,
    updatedAt: typeof value.updatedAt === "string" && value.updatedAt.length > 0 ? value.updatedAt : nowIso(),
  };
}

export function readState(): SurfwrightState {
  const statePath = stateFilePath();
  return readStateFromPath(statePath);
}

function readStateFromPath(statePath: string): SurfwrightState {
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<SurfwrightState> | null;
    if (typeof parsed !== "object" || parsed === null) {
      return emptyState();
    }

    const sessions: Record<string, SessionState> = {};
    if (typeof parsed.sessions === "object" && parsed.sessions !== null) {
      for (const [sessionId, rawSession] of Object.entries(parsed.sessions)) {
        const normalized = normalizeSession(sessionId, rawSession);
        if (normalized) {
          sessions[sessionId] = normalized;
        }
      }
    }

    const targets: Record<string, TargetState> = {};
    if (typeof parsed.targets === "object" && parsed.targets !== null) {
      for (const [targetId, rawTarget] of Object.entries(parsed.targets)) {
        const normalized = normalizeTarget(rawTarget);
        if (normalized && normalized.targetId === targetId) {
          targets[targetId] = normalized;
        }
      }
    }

    const activeSessionId =
      typeof parsed.activeSessionId === "string" && parsed.activeSessionId.length > 0 ? parsed.activeSessionId : null;

    const nextSessionOrdinal = asPositiveInteger(parsed.nextSessionOrdinal) ?? 1;

    return {
      version: STATE_VERSION,
      activeSessionId,
      nextSessionOrdinal,
      sessions,
      targets,
    };
  } catch {
    return emptyState();
  }
}

function writeStateAtomic(state: SurfwrightState) {
  const rootDir = stateRootDir();
  fs.mkdirSync(rootDir, { recursive: true });

  const finalPath = stateFilePath();
  const tempPath = path.join(rootDir, `state.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  const payload = `${JSON.stringify(state, null, 2)}\n`;

  fs.writeFileSync(tempPath, payload, { encoding: "utf8", flag: "wx" });

  try {
    fs.renameSync(tempPath, finalPath);
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // If rename succeeded, temp file no longer exists.
    }
  }
}

function readLockTimestampMs(lockPath: string): number | null {
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw) as { createdAt?: unknown } | null;
    if (parsed && typeof parsed.createdAt === "string") {
      const t = Date.parse(parsed.createdAt);
      if (Number.isFinite(t)) {
        return t;
      }
    }
  } catch {
    // fall back to file mtime
  }

  try {
    const stat = fs.statSync(lockPath);
    return Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : null;
  } catch {
    return null;
  }
}

function clearStaleLock(lockPath: string): boolean {
  const createdMs = readLockTimestampMs(lockPath);
  if (createdMs === null) {
    return false;
  }
  if (Date.now() - createdMs < STATE_LOCK_STALE_MS) {
    return false;
  }

  try {
    fs.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function tryCreateLock(lockPath: string): boolean {
  try {
    const fd = fs.openSync(lockPath, "wx");
    try {
      fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, createdAt: nowIso() })}\n`, "utf8");
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EEXIST") {
      return false;
    }
    throw new CliError("E_STATE_LOCK_IO", `Failed to create state lock: ${err.message ?? "unknown error"}`);
  }
}

function releaseLock(lockPath: string) {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // ignore missing lock on release
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const rootDir = stateRootDir();
  fs.mkdirSync(rootDir, { recursive: true });

  const lockPath = stateLockFilePath();
  const deadline = Date.now() + STATE_LOCK_TIMEOUT_MS;

  while (true) {
    if (tryCreateLock(lockPath)) {
      try {
        return await fn();
      } finally {
        releaseLock(lockPath);
      }
    }

    clearStaleLock(lockPath);

    if (Date.now() >= deadline) {
      throw new CliError("E_STATE_LOCK_TIMEOUT", "Timed out waiting for state lock");
    }

    await sleep(STATE_LOCK_RETRY_MS);
  }
}

export async function updateState<T>(mutate: (state: SurfwrightState) => Promise<T> | T): Promise<T> {
  return await withStateLock(async () => {
    const state = readStateFromPath(stateFilePath());
    const result = await mutate(state);
    writeStateAtomic(state);
    return result;
  });
}

export async function writeState(state: SurfwrightState) {
  await withStateLock(async () => {
    writeStateAtomic(state);
  });
}

export function sanitizeSessionId(input: string): string {
  const value = input.trim();
  if (!SESSION_ID_PATTERN.test(value)) {
    throw new CliError("E_SESSION_ID_INVALID", "sessionId may only contain letters, numbers, dot, underscore, and dash");
  }
  return value;
}

export function allocateSessionId(state: SurfwrightState, prefix: "s" | "a"): string {
  let ordinal = state.nextSessionOrdinal;
  if (!Number.isFinite(ordinal) || ordinal <= 0) {
    ordinal = 1;
  }

  let candidate = `${prefix}-${Math.floor(ordinal)}`;
  while (state.sessions[candidate]) {
    ordinal += 1;
    candidate = `${prefix}-${Math.floor(ordinal)}`;
  }

  state.nextSessionOrdinal = Math.floor(ordinal) + 1;
  return candidate;
}

export function assertSessionDoesNotExist(state: SurfwrightState, sessionId: string) {
  if (state.sessions[sessionId]) {
    throw new CliError("E_SESSION_EXISTS", `Session ${sessionId} already exists`);
  }
}

export async function upsertTargetState(target: TargetState) {
  await updateState((state) => {
    state.targets[target.targetId] = target;
    const session = state.sessions[target.sessionId];
    if (session) {
      state.sessions[target.sessionId] = {
        ...session,
        lastSeenAt: nowIso(),
      };
    }
  });
}
