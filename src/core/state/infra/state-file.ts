import fs from "node:fs";
import path from "node:path";
import { CliError } from "../../errors.js";
import { asPositiveInteger } from "../../shared/index.js";
import { normalizeSessionState } from "../../session/index.js";
import { STATE_VERSION, type SessionState, type SurfwrightState, type TargetState } from "../../types.js";

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

function normalizeTarget(raw: unknown, nowIso: () => string): TargetState | null {
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

export function readStateFromFilePath(opts: {
  statePath: string;
  nowIso: () => string;
  defaultSessionUserDataDir: (sessionId: string) => string;
  inferDebugPortFromCdpOrigin: (cdpOrigin: string) => number | null;
  emptyState: () => SurfwrightState;
}): SurfwrightState {
  try {
    const raw = fs.readFileSync(opts.statePath, "utf8");
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(raw);
    } catch {
      throwStateReadFailure({
        code: "E_STATE_READ_INVALID",
        message: "state file is not valid JSON",
        statePath: opts.statePath,
        raw,
      });
    }
    if (typeof parsedRaw !== "object" || parsedRaw === null) {
      throwStateReadFailure({
        code: "E_STATE_READ_INVALID",
        message: "state file must contain a JSON object",
        statePath: opts.statePath,
        raw,
      });
    }

    const parsed = parsedRaw as Partial<SurfwrightState>;
    if (parsed.version !== STATE_VERSION) {
      throwStateReadFailure({
        code: "E_STATE_VERSION_MISMATCH",
        message: `state version mismatch: expected ${STATE_VERSION}`,
        statePath: opts.statePath,
        raw,
      });
    }

    const sessions: Record<string, SessionState> = {};
    if (typeof parsed.sessions === "object" && parsed.sessions !== null) {
      for (const [sessionId, rawSession] of Object.entries(parsed.sessions)) {
        const normalized = normalizeSessionState({
          sessionId,
          raw: rawSession,
          defaultUserDataDir: opts.defaultSessionUserDataDir,
          inferDebugPortFromCdpOrigin: opts.inferDebugPortFromCdpOrigin,
          nowIso: opts.nowIso,
        });
        if (normalized) {
          sessions[sessionId] = normalized;
        }
      }
    }

    const targets: Record<string, TargetState> = {};
    if (typeof parsed.targets === "object" && parsed.targets !== null) {
      for (const [targetId, rawTarget] of Object.entries(parsed.targets)) {
        const normalized = normalizeTarget(rawTarget, opts.nowIso);
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
      return opts.emptyState();
    }
    throw new CliError("E_STATE_READ_FAILED", "Unable to read state file", {
      phase: "state.read",
      hintContext: {
        statePath: opts.statePath,
        cause: typeof maybe.message === "string" ? maybe.message : null,
      },
    });
  }
}
