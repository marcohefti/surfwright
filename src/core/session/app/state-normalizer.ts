import {
  currentAgentId,
  defaultSessionPolicyForKind,
  leaseExpiryIso,
  normalizeAgentId,
  normalizeSessionPolicy,
  normalizeSessionLeaseTtlMs,
  sessionDefaultLeaseTtlMs,
} from "./hygiene.js";
import { asNonNegativeInteger, asPositiveInteger } from "../../shared/index.js";
import type { BrowserMode, SessionKind, SessionState } from "../../types.js";

function normalizeAppliedExtensions(raw: unknown): SessionState["appliedExtensions"] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const normalized: SessionState["appliedExtensions"] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const value = entry as {
      id?: unknown;
      name?: unknown;
      version?: unknown;
      path?: unknown;
      manifestVersion?: unknown;
      enabled?: unknown;
      buildFingerprint?: unknown;
      state?: unknown;
      runtimeId?: unknown;
    };
    if (
      typeof value.id !== "string" ||
      value.id.length === 0 ||
      typeof value.name !== "string" ||
      value.name.length === 0 ||
      typeof value.version !== "string" ||
      value.version.length === 0 ||
      typeof value.path !== "string" ||
      value.path.length === 0 ||
      typeof value.enabled !== "boolean" ||
      typeof value.buildFingerprint !== "string" ||
      value.buildFingerprint.length === 0
    ) {
      continue;
    }
    normalized.push({
      id: value.id,
      name: value.name,
      version: value.version,
      path: value.path,
      manifestVersion:
        typeof value.manifestVersion === "number" && Number.isFinite(value.manifestVersion) ? value.manifestVersion : null,
      enabled: value.enabled,
      buildFingerprint: value.buildFingerprint,
      state: value.state === "runtime-installed" ? "runtime-installed" : "registry-only",
      runtimeId: typeof value.runtimeId === "string" && value.runtimeId.length > 0 ? value.runtimeId : null,
    });
  }
  return normalized;
}

export function normalizeSessionState(opts: {
  sessionId: string;
  raw: unknown;
  defaultUserDataDir: (sessionId: string) => string;
  inferDebugPortFromCdpOrigin: (cdpOrigin: string) => number | null;
  nowIso: () => string;
}): SessionState | null {
  if (typeof opts.raw !== "object" || opts.raw === null) {
    return null;
  }
  const value = opts.raw as {
    kind?: unknown;
    policy?: unknown;
    browserMode?: unknown;
    cdpOrigin?: unknown;
    debugPort?: unknown;
    userDataDir?: unknown;
    profile?: unknown;
    browserPid?: unknown;
    ownerId?: unknown;
    leaseExpiresAt?: unknown;
    leaseTtlMs?: unknown;
    managedUnreachableSince?: unknown;
    managedUnreachableCount?: unknown;
    extensionSetFingerprint?: unknown;
    appliedExtensions?: unknown;
    createdAt?: unknown;
    lastSeenAt?: unknown;
  };
  if (typeof value.cdpOrigin !== "string" || value.cdpOrigin.length === 0) {
    return null;
  }

  const kind: SessionKind = value.kind === "attached" ? "attached" : "managed";
  const policy = normalizeSessionPolicy(value.policy) ?? defaultSessionPolicyForKind(kind);
  const browserMode: BrowserMode =
    kind === "attached" ? "unknown" : value.browserMode === "headed" ? "headed" : "headless";
  const debugPort = asPositiveInteger(value.debugPort) ?? opts.inferDebugPortFromCdpOrigin(value.cdpOrigin);
  const userDataDir =
    kind === "managed"
      ? typeof value.userDataDir === "string" && value.userDataDir.length > 0
        ? value.userDataDir
        : opts.defaultUserDataDir(opts.sessionId)
      : null;
  const profile =
    kind === "managed" && typeof value.profile === "string" && value.profile.trim().length > 0 ? value.profile.trim() : null;
  const browserPid = asPositiveInteger(value.browserPid);
  const createdAt = typeof value.createdAt === "string" && value.createdAt.length > 0 ? value.createdAt : opts.nowIso();
  const lastSeenAt = typeof value.lastSeenAt === "string" && value.lastSeenAt.length > 0 ? value.lastSeenAt : opts.nowIso();
  const leaseTtlMs = normalizeSessionLeaseTtlMs(value.leaseTtlMs) ?? sessionDefaultLeaseTtlMs(policy);
  const ownerId = typeof value.ownerId === "string" ? normalizeAgentId(value.ownerId) : currentAgentId();
  const extensionSetFingerprint =
    kind === "managed" && typeof value.extensionSetFingerprint === "string" && value.extensionSetFingerprint.length > 0
      ? value.extensionSetFingerprint
      : null;
  const appliedExtensions = kind === "managed" ? normalizeAppliedExtensions(value.appliedExtensions) : [];

  return {
    sessionId: opts.sessionId,
    kind,
    policy,
    browserMode,
    cdpOrigin: value.cdpOrigin,
    debugPort,
    userDataDir,
    profile,
    browserPid,
    ownerId,
    leaseTtlMs,
    leaseExpiresAt:
      typeof value.leaseExpiresAt === "string" && value.leaseExpiresAt.length > 0
        ? value.leaseExpiresAt
        : leaseExpiryIso(opts.nowIso(), leaseTtlMs),
    managedUnreachableSince:
      typeof value.managedUnreachableSince === "string" && value.managedUnreachableSince.length > 0
        ? value.managedUnreachableSince
        : null,
    managedUnreachableCount: asNonNegativeInteger(value.managedUnreachableCount) ?? 0,
    extensionSetFingerprint,
    appliedExtensions,
    createdAt,
    lastSeenAt,
  };
}
