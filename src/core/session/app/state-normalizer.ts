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
    browserPid?: unknown;
    ownerId?: unknown;
    leaseExpiresAt?: unknown;
    leaseTtlMs?: unknown;
    managedUnreachableSince?: unknown;
    managedUnreachableCount?: unknown;
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
  const browserPid = asPositiveInteger(value.browserPid);
  const createdAt = typeof value.createdAt === "string" && value.createdAt.length > 0 ? value.createdAt : opts.nowIso();
  const lastSeenAt = typeof value.lastSeenAt === "string" && value.lastSeenAt.length > 0 ? value.lastSeenAt : opts.nowIso();
  const leaseTtlMs = normalizeSessionLeaseTtlMs(value.leaseTtlMs) ?? sessionDefaultLeaseTtlMs(policy);
  const ownerId = typeof value.ownerId === "string" ? normalizeAgentId(value.ownerId) : currentAgentId();

  return {
    sessionId: opts.sessionId,
    kind,
    policy,
    browserMode,
    cdpOrigin: value.cdpOrigin,
    debugPort,
    userDataDir,
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
    createdAt,
    lastSeenAt,
  };
}
