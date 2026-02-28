import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import type { SurfwrightState, TargetState } from "../../types.js";

const STATE_V2_DIRNAME = "state-v2";
const TARGETS_BY_SESSION_DIRNAME = "targets-by-session";
const META_FILENAME = "meta.json";
const SESSIONS_FILENAME = "sessions.json";
const NETWORK_CAPTURES_FILENAME = "network-captures.json";
const NETWORK_ARTIFACTS_FILENAME = "network-artifacts.json";
const SHARD_TEMP_SUFFIX = ".tmp";

type StateMetaShard = Pick<
  SurfwrightState,
  "version" | "activeSessionId" | "nextSessionOrdinal" | "nextCaptureOrdinal" | "nextArtifactOrdinal"
> & {
  revision: number;
};

function stateV2Root(stateRoot: string): string {
  return path.join(stateRoot, STATE_V2_DIRNAME);
}

function targetsBySessionRoot(stateRoot: string): string {
  return path.join(stateV2Root(stateRoot), TARGETS_BY_SESSION_DIRNAME);
}

function shardPath(stateRoot: string, filename: string): string {
  return path.join(stateV2Root(stateRoot), filename);
}

function safeSessionShardName(sessionId: string): string {
  return `${encodeURIComponent(sessionId)}.json`;
}

function parseSessionShardName(filename: string): string | null {
  if (!filename.endsWith(".json")) {
    return null;
  }
  const base = filename.slice(0, -5);
  if (base.length === 0) {
    return null;
  }
  try {
    return decodeURIComponent(base);
  } catch {
    return null;
  }
}

function readJsonIfExists(filePath: string): unknown | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    const maybe = error as NodeJS.ErrnoException;
    if (maybe.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function readJsonObjectIfExists(filePath: string): Record<string, unknown> | null {
  const parsed = readJsonIfExists(filePath);
  if (parsed === null) {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`state shard must be JSON object: ${filePath}`);
  }
  return parsed as Record<string, unknown>;
}

function toPositiveIntOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function payloadForJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function writeAtomicIfChanged(filePath: string, payload: string): boolean {
  try {
    const existing = fs.readFileSync(filePath, "utf8");
    if (existing === payload) {
      return false;
    }
  } catch {
    // file may not exist yet
  }

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}${SHARD_TEMP_SUFFIX}`;
  fs.writeFileSync(tempPath, payload, { encoding: "utf8", flag: "wx" });
  try {
    fs.renameSync(tempPath, filePath);
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // rename already moved file
    }
  }
  return true;
}

function buildTargetsBySession(targets: Record<string, TargetState>): Map<string, Record<string, TargetState>> {
  const bySession = new Map<string, Record<string, TargetState>>();
  for (const [targetId, target] of Object.entries(targets)) {
    const bucket = bySession.get(target.sessionId) ?? {};
    bucket[targetId] = target;
    bySession.set(target.sessionId, bucket);
  }
  return bySession;
}

export function readStateFromV2Shards(stateRoot: string): SurfwrightState | null {
  const metaRaw = readJsonObjectIfExists(shardPath(stateRoot, META_FILENAME));
  if (!metaRaw) {
    return null;
  }

  const sessionsRaw = readJsonObjectIfExists(shardPath(stateRoot, SESSIONS_FILENAME)) ?? {};
  const networkCapturesRaw = readJsonObjectIfExists(shardPath(stateRoot, NETWORK_CAPTURES_FILENAME)) ?? {};
  const networkArtifactsRaw = readJsonObjectIfExists(shardPath(stateRoot, NETWORK_ARTIFACTS_FILENAME)) ?? {};

  const targets: SurfwrightState["targets"] = {};
  const targetsRoot = targetsBySessionRoot(stateRoot);
  try {
    const entries = fs
      .readdirSync(targetsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
    for (const filename of entries) {
      const sessionId = parseSessionShardName(filename);
      if (!sessionId) {
        continue;
      }
      const shard = readJsonObjectIfExists(path.join(targetsRoot, filename));
      if (!shard) {
        continue;
      }
      for (const [targetId, raw] of Object.entries(shard)) {
        if (typeof raw !== "object" || raw === null) {
          continue;
        }
        const target = raw as TargetState;
        if (target.sessionId !== sessionId) {
          continue;
        }
        targets[targetId] = target;
      }
    }
  } catch {
    // targets directory may not exist yet
  }

  const state: SurfwrightState = {
    version: toPositiveIntOr(metaRaw.version, 1),
    activeSessionId: typeof metaRaw.activeSessionId === "string" && metaRaw.activeSessionId.length > 0 ? metaRaw.activeSessionId : null,
    nextSessionOrdinal: toPositiveIntOr(metaRaw.nextSessionOrdinal, 1),
    nextCaptureOrdinal: toPositiveIntOr(metaRaw.nextCaptureOrdinal, 1),
    nextArtifactOrdinal: toPositiveIntOr(metaRaw.nextArtifactOrdinal, 1),
    sessions: sessionsRaw as SurfwrightState["sessions"],
    targets,
    networkCaptures: networkCapturesRaw as SurfwrightState["networkCaptures"],
    networkArtifacts: networkArtifactsRaw as SurfwrightState["networkArtifacts"],
  };
  return state;
}

export function readStateRevisionFromV2Shards(stateRoot: string): number {
  const metaRaw = readJsonObjectIfExists(shardPath(stateRoot, META_FILENAME));
  if (!metaRaw) {
    return 0;
  }
  return toPositiveIntOr(metaRaw.revision, 0);
}

export function writeStateToV2Shards(
  stateRoot: string,
  state: SurfwrightState,
  opts?: {
    nextRevision?: number;
  },
): boolean {
  const v2Root = stateV2Root(stateRoot);
  const targetsRoot = targetsBySessionRoot(stateRoot);
  fs.mkdirSync(v2Root, { recursive: true });
  fs.mkdirSync(targetsRoot, { recursive: true });

  let changed = false;
  const revision =
    typeof opts?.nextRevision === "number" && Number.isFinite(opts.nextRevision) && opts.nextRevision > 0
      ? Math.floor(opts.nextRevision)
      : Math.max(1, readStateRevisionFromV2Shards(stateRoot) + 1);
  const meta: StateMetaShard = {
    version: state.version,
    activeSessionId: state.activeSessionId,
    nextSessionOrdinal: state.nextSessionOrdinal,
    nextCaptureOrdinal: state.nextCaptureOrdinal,
    nextArtifactOrdinal: state.nextArtifactOrdinal,
    revision,
  };
  changed = writeAtomicIfChanged(shardPath(stateRoot, META_FILENAME), payloadForJson(meta)) || changed;
  changed = writeAtomicIfChanged(shardPath(stateRoot, SESSIONS_FILENAME), payloadForJson(state.sessions)) || changed;
  changed =
    writeAtomicIfChanged(shardPath(stateRoot, NETWORK_CAPTURES_FILENAME), payloadForJson(state.networkCaptures)) || changed;
  changed =
    writeAtomicIfChanged(shardPath(stateRoot, NETWORK_ARTIFACTS_FILENAME), payloadForJson(state.networkArtifacts)) || changed;

  const nextTargetsBySession = buildTargetsBySession(state.targets);
  const nextFilenames = new Set<string>();
  for (const [sessionId, targets] of nextTargetsBySession.entries()) {
    const filename = safeSessionShardName(sessionId);
    nextFilenames.add(filename);
    const shardFilePath = path.join(targetsRoot, filename);
    changed = writeAtomicIfChanged(shardFilePath, payloadForJson(targets)) || changed;
  }

  try {
    const existingFiles = fs
      .readdirSync(targetsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name);
    for (const filename of existingFiles) {
      if (nextFilenames.has(filename)) {
        continue;
      }
      try {
        fs.unlinkSync(path.join(targetsRoot, filename));
        changed = true;
      } catch {
        // ignore stale file race
      }
    }
  } catch {
    // ignore if directory cannot be listed
  }

  return changed;
}
