import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { CliError } from "../../errors.js";
import { asPositiveInteger } from "../../shared/index.js";
import { currentAgentId, normalizeSessionState, withSessionHeartbeat } from "../../session/index.js";
import { STATE_VERSION, type SessionState, type SurfwrightState, type TargetState } from "../../types.js";
import { withStateFileLock } from "./state-lock.js";
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const STATE_LOCK_FILENAME = "state.lock";
const STATE_LOCK_RETRY_MS = 40;
const STATE_LOCK_TIMEOUT_MS = 12000;
const STATE_LOCK_STALE_MS = 12000;
function quarantineStateFile(statePath: string, raw: string): string | null {
  const quarantinePath = path.join(path.dirname(statePath), `state.corrupt.${Date.now()}.${Math.random().toString(16).slice(2)}.json`);
  try {
    fs.renameSync(statePath, quarantinePath);
    return quarantinePath;
  } catch {
    try {
      fs.writeFileSync(quarantinePath, raw, { encoding: "utf8", flag: "wx", mode: 0o600 });
      return quarantinePath;
    } catch {
      return null;
    }
  }
}

function throwStateReadFailure(opts: {
  code: "E_STATE_READ_INVALID" | "E_STATE_VERSION_MISMATCH";
  message: string;
  statePath: string;
  raw: string;
}): never {
  const quarantinedPath = quarantineStateFile(opts.statePath, opts.raw);
  throw new CliError(opts.code, opts.message, {
    phase: "state.read",
    recovery: {
      strategy: "repair-state-file",
      nextCommand: "surfwright state reconcile",
      requiredFields: ["statePath"],
      context: {
        statePath: opts.statePath,
        quarantinedPath,
      },
    },
    hints: quarantinedPath
      ? [`quarantined state snapshot: ${quarantinedPath}`]
      : ["state snapshot could not be quarantined automatically; inspect state.json permissions"],
    hintContext: {
      statePath: opts.statePath,
      quarantinedPath,
    },
  });
}
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
    lastActionId?: unknown;
    lastActionAt?: unknown;
    lastActionKind?: unknown;
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
    lastActionId: typeof value.lastActionId === "string" && value.lastActionId.length > 0 ? value.lastActionId : null,
    lastActionAt: typeof value.lastActionAt === "string" && value.lastActionAt.length > 0 ? value.lastActionAt : null,
    lastActionKind:
      typeof value.lastActionKind === "string" && value.lastActionKind.length > 0 ? value.lastActionKind : null,
    updatedAt: typeof value.updatedAt === "string" && value.updatedAt.length > 0 ? value.updatedAt : nowIso(),
  };
}

function normalizeNetworkCapture(captureId: string, raw: unknown): SurfwrightState["networkCaptures"][string] | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const value = raw as {
    captureId?: unknown;
    sessionId?: unknown;
    targetId?: unknown;
    startedAt?: unknown;
    status?: unknown;
    profile?: unknown;
    maxRuntimeMs?: unknown;
    workerPid?: unknown;
    stopSignalPath?: unknown;
    donePath?: unknown;
    resultPath?: unknown;
    endedAt?: unknown;
    actionId?: unknown;
  };
  if (
    typeof value.sessionId !== "string" ||
    typeof value.targetId !== "string" ||
    typeof value.startedAt !== "string" ||
    typeof value.stopSignalPath !== "string" ||
    typeof value.donePath !== "string" ||
    typeof value.resultPath !== "string"
  ) {
    return null;
  }
  const status = value.status === "stopped" || value.status === "failed" ? value.status : "recording";
  const profile =
    value.profile === "api" || value.profile === "page" || value.profile === "ws" || value.profile === "perf"
      ? value.profile
      : "custom";
  return {
    captureId: typeof value.captureId === "string" && value.captureId.length > 0 ? value.captureId : captureId,
    sessionId: value.sessionId,
    targetId: value.targetId,
    startedAt: value.startedAt,
    status,
    profile,
    maxRuntimeMs: asPositiveInteger(value.maxRuntimeMs) ?? 600000,
    workerPid: asPositiveInteger(value.workerPid),
    stopSignalPath: value.stopSignalPath,
    donePath: value.donePath,
    resultPath: value.resultPath,
    endedAt: typeof value.endedAt === "string" && value.endedAt.length > 0 ? value.endedAt : null,
    actionId: typeof value.actionId === "string" && value.actionId.length > 0 ? value.actionId : "a-unknown",
  };
}

function normalizeNetworkArtifact(artifactId: string, raw: unknown): SurfwrightState["networkArtifacts"][string] | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const value = raw as {
    artifactId?: unknown;
    createdAt?: unknown;
    format?: unknown;
    path?: unknown;
    sessionId?: unknown;
    targetId?: unknown;
    captureId?: unknown;
    entries?: unknown;
    bytes?: unknown;
  };
  if (
    typeof value.createdAt !== "string" ||
    typeof value.path !== "string" ||
    typeof value.sessionId !== "string" ||
    typeof value.targetId !== "string"
  ) {
    return null;
  }
  return {
    artifactId: typeof value.artifactId === "string" && value.artifactId.length > 0 ? value.artifactId : artifactId,
    createdAt: value.createdAt,
    format: "har",
    path: value.path,
    sessionId: value.sessionId,
    targetId: value.targetId,
    captureId: typeof value.captureId === "string" && value.captureId.length > 0 ? value.captureId : null,
    entries: asPositiveInteger(value.entries) ?? 0,
    bytes: asPositiveInteger(value.bytes) ?? 0,
  };
}
export function readState(): SurfwrightState {
  const statePath = stateFilePath();
  return readStateFromPath(statePath);
}

function readStateFromPath(statePath: string): SurfwrightState {
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(raw);
    } catch {
      throwStateReadFailure({
        code: "E_STATE_READ_INVALID",
        message: "state file is not valid JSON",
        statePath,
        raw,
      });
    }
    if (typeof parsedRaw !== "object" || parsedRaw === null) {
      throwStateReadFailure({
        code: "E_STATE_READ_INVALID",
        message: "state file must contain a JSON object",
        statePath,
        raw,
      });
    }
    const parsed = parsedRaw as Partial<SurfwrightState>;
    if (parsed.version !== STATE_VERSION) {
      throwStateReadFailure({
        code: "E_STATE_VERSION_MISMATCH",
        message: `state version mismatch: expected ${STATE_VERSION}`,
        statePath,
        raw,
      });
    }
    const sessions: Record<string, SessionState> = {};
    if (typeof parsed.sessions === "object" && parsed.sessions !== null) {
      for (const [sessionId, rawSession] of Object.entries(parsed.sessions)) {
        const normalized = normalizeSessionState({
          sessionId,
          raw: rawSession,
          defaultUserDataDir: defaultSessionUserDataDir,
          inferDebugPortFromCdpOrigin,
          nowIso,
        });
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
    const nextCaptureOrdinal = asPositiveInteger((parsed as { nextCaptureOrdinal?: unknown }).nextCaptureOrdinal) ?? 1;
    const nextArtifactOrdinal =
      asPositiveInteger((parsed as { nextArtifactOrdinal?: unknown }).nextArtifactOrdinal) ?? 1;
    const networkCaptures: SurfwrightState["networkCaptures"] = {};
    const rawCaptures = (parsed as { networkCaptures?: unknown }).networkCaptures;
    if (typeof rawCaptures === "object" && rawCaptures !== null) {
      for (const [captureId, rawCapture] of Object.entries(rawCaptures)) {
        const normalized = normalizeNetworkCapture(captureId, rawCapture);
        if (normalized) {
          networkCaptures[captureId] = normalized;
        }
      }
    }
    const networkArtifacts: SurfwrightState["networkArtifacts"] = {};
    const rawArtifacts = (parsed as { networkArtifacts?: unknown }).networkArtifacts;
    if (typeof rawArtifacts === "object" && rawArtifacts !== null) {
      for (const [artifactId, rawArtifact] of Object.entries(rawArtifacts)) {
        const normalized = normalizeNetworkArtifact(artifactId, rawArtifact);
        if (normalized) {
          networkArtifacts[artifactId] = normalized;
        }
      }
    }
    return {
      version: STATE_VERSION,
      activeSessionId,
      nextSessionOrdinal,
      nextCaptureOrdinal,
      nextArtifactOrdinal,
      sessions,
      targets,
      networkCaptures,
      networkArtifacts,
    };
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    const maybe = error as { code?: unknown; message?: unknown };
    if (maybe.code === "ENOENT") {
      return emptyState();
    }
    throw new CliError("E_STATE_READ_FAILED", "Unable to read state file", {
      phase: "state.read",
      hintContext: {
        statePath,
        cause: typeof maybe.message === "string" ? maybe.message : null,
      },
    });
  }
}
function writeStateAtomic(state: SurfwrightState): boolean {
  const rootDir = stateRootDir();
  fs.mkdirSync(rootDir, { recursive: true });
  const finalPath = stateFilePath();
  const tempPath = path.join(rootDir, `state.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  const payload = `${JSON.stringify(state)}\n`;
  try {
    const existing = fs.readFileSync(finalPath, "utf8");
    if (existing === payload) {
      return false;
    }
  } catch {
    // state file may not exist on first write.
  }
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
  return true;
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
