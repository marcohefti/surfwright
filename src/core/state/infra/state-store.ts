import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { CliError } from "../../errors.js";
import { currentAgentId, withSessionHeartbeat } from "../../session/index.js";
import { STATE_VERSION, type SurfwrightState, type TargetState } from "../../types.js";
import { withStateFileLock } from "./state-lock.js";
import { readStateFromFilePath } from "./state-file.js";
import { readStateFromV2Shards, readStateRevisionFromV2Shards, writeStateToV2Shards } from "./state-shards.js";
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const STATE_LOCK_FILENAME = "state.lock";
const STATE_LOCK_RETRY_MS = 40;
const STATE_LOCK_TIMEOUT_MS = 12000;
const STATE_LOCK_STALE_MS = 12000;
const STATE_OPTIMISTIC_RETRY_ATTEMPTS = 4;
export function stateRootDir(): string {
  const fromEnv = process.env.SURFWRIGHT_STATE_DIR;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv.trim());
  }
  const agentId = currentAgentId();
  if (agentId) {
    return path.join(os.homedir(), ".surfwright", "agents", agentId);
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
    nextCaptureOrdinal: 1,
    nextArtifactOrdinal: 1,
    sessions: {},
    targets: {},
    networkCaptures: {},
    networkArtifacts: {},
  };
}

export function nowIso(): string {
  return new Date().toISOString();
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
export function readState(): SurfwrightState {
  const rootDir = stateRootDir();
  const fromShards = readStateFromV2Shards(rootDir);
  if (fromShards) {
    if (fromShards.version !== STATE_VERSION) {
      throw new CliError("E_STATE_VERSION_MISMATCH", `state version mismatch: expected ${STATE_VERSION}`, {
        phase: "state.read",
        hintContext: {
          storage: "state-v2",
          stateRoot: rootDir,
          foundVersion: fromShards.version,
        },
      });
    }
    return fromShards;
  }
  return readStateFromPath(stateFilePath());
}

function readStateFromPath(statePath: string): SurfwrightState {
  return readStateFromFilePath({
    statePath,
    nowIso,
    defaultSessionUserDataDir,
    inferDebugPortFromCdpOrigin,
    emptyState,
  });
}
function writeStateAtomic(
  state: SurfwrightState,
  opts?: {
    nextRevision?: number;
  },
): boolean {
  const rootDir = stateRootDir();
  fs.mkdirSync(rootDir, { recursive: true });
  return writeStateToV2Shards(rootDir, state, opts);
}
async function withStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const rootDir = stateRootDir();
  const lockPath = stateLockFilePath();
  return await withStateFileLock(
    {
      rootDir,
      lockPath,
      timeoutMs: STATE_LOCK_TIMEOUT_MS,
      retryMs: STATE_LOCK_RETRY_MS,
      staleMs: STATE_LOCK_STALE_MS,
      nowIso,
    },
    fn,
  );
}

export async function updateState<T>(mutate: (state: SurfwrightState) => Promise<T> | T): Promise<T> {
  const rootDir = stateRootDir();
  for (let attempt = 0; attempt < STATE_OPTIMISTIC_RETRY_ATTEMPTS; attempt += 1) {
    const baseRevision = readStateRevisionFromV2Shards(rootDir);
    const state = readState();
    const result = await mutate(state);
    let committed = false;

    await withStateLock(async () => {
      const currentRevision = readStateRevisionFromV2Shards(rootDir);
      if (currentRevision !== baseRevision) {
        return;
      }
      writeStateAtomic(state, {
        nextRevision: baseRevision + 1,
      });
      committed = true;
    });

    if (committed) {
      return result;
    }
  }

  throw new CliError("E_STATE_LOCK_TIMEOUT", "State mutation retry budget exhausted under concurrent writes");
}

export async function writeState(state: SurfwrightState) {
  const rootDir = stateRootDir();
  await withStateLock(async () => {
    const currentRevision = readStateRevisionFromV2Shards(rootDir);
    writeStateAtomic(state, {
      nextRevision: currentRevision + 1,
    });
  });
}

export function sanitizeSessionId(input: string): string {
  const value = input.trim();
  const lowered = value.toLowerCase();
  if (lowered === "undefined" || lowered === "null" || lowered === "nan") {
    throw new CliError("E_SESSION_ID_INVALID", "sessionId must be an explicit non-placeholder handle");
  }
  if (!SESSION_ID_PATTERN.test(value)) {
    throw new CliError("E_SESSION_ID_INVALID", "sessionId may only contain letters, numbers, dot, underscore, and dash");
  }
  return value;
}

export function allocateSessionId(state: SurfwrightState, prefix: "s" | "a"): string {
  const profileExistsForSession = (sessionId: string): boolean => {
    if (prefix !== "s") {
      return false;
    }
    try {
      return fs.existsSync(defaultSessionUserDataDir(sessionId));
    } catch {
      return false;
    }
  };

  let ordinal = state.nextSessionOrdinal;
  if (!Number.isFinite(ordinal) || ordinal <= 0) {
    ordinal = 1;
  }
  let candidate = `${prefix}-${Math.floor(ordinal)}`;
  while (state.sessions[candidate] || profileExistsForSession(candidate)) {
    ordinal += 1;
    candidate = `${prefix}-${Math.floor(ordinal)}`;
  }
  state.nextSessionOrdinal = Math.floor(ordinal) + 1;
  return candidate;
}
export function allocateCaptureId(state: SurfwrightState): string {
  let ordinal = state.nextCaptureOrdinal;
  if (!Number.isFinite(ordinal) || ordinal <= 0) {
    ordinal = 1;
  }
  let candidate = `c-${Math.floor(ordinal)}`;
  while (state.networkCaptures[candidate]) {
    ordinal += 1;
    candidate = `c-${Math.floor(ordinal)}`;
  }
  state.nextCaptureOrdinal = Math.floor(ordinal) + 1;
  return candidate;
}
export function allocateArtifactId(state: SurfwrightState): string {
  let ordinal = state.nextArtifactOrdinal;
  if (!Number.isFinite(ordinal) || ordinal <= 0) {
    ordinal = 1;
  }
  let candidate = `na-${Math.floor(ordinal)}`;
  while (state.networkArtifacts[candidate]) {
    ordinal += 1;
    candidate = `na-${Math.floor(ordinal)}`;
  }
  state.nextArtifactOrdinal = Math.floor(ordinal) + 1;
  return candidate;
}

export function assertSessionDoesNotExist(state: SurfwrightState, sessionId: string) {
  if (state.sessions[sessionId]) {
    throw new CliError("E_SESSION_EXISTS", `Session ${sessionId} already exists`);
  }
}

function applyTargetStateUpdate(state: SurfwrightState, target: TargetState) {
  const existing = state.targets[target.targetId];
  state.targets[target.targetId] = {
    ...target,
    lastActionId: typeof target.lastActionId === "undefined" ? (existing?.lastActionId ?? null) : target.lastActionId,
    lastActionAt: typeof target.lastActionAt === "undefined" ? (existing?.lastActionAt ?? null) : target.lastActionAt,
    lastActionKind: typeof target.lastActionKind === "undefined" ? (existing?.lastActionKind ?? null) : target.lastActionKind,
  };
  const session = state.sessions[target.sessionId];
  if (session) {
    state.sessions[target.sessionId] = withSessionHeartbeat(session);
  }
}

export async function upsertTargetState(target: TargetState) {
  await updateState((state) => {
    applyTargetStateUpdate(state, target);
  });
}

export async function upsertTargetStates(targets: TargetState[]) {
  await updateState((state) => {
    for (const target of targets) {
      applyTargetStateUpdate(state, target);
    }
  });
}
