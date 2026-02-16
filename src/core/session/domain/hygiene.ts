import {
  DEFAULT_EPHEMERAL_SESSION_LEASE_TTL_MS,
  DEFAULT_SESSION_LEASE_TTL_MS,
  MAX_SESSION_LEASE_TTL_MS,
  MIN_SESSION_LEASE_TTL_MS,
  type SessionPolicy,
  type SessionState,
} from "../../types.js";

const AGENT_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeAgentId(input: string): string | null {
  const value = input.trim();
  if (value.length === 0) {
    return null;
  }
  if (AGENT_ID_PATTERN.test(value)) {
    return value;
  }
  const normalized = value
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  if (normalized.length === 0) {
    return null;
  }
  return normalized.slice(0, 64);
}

export function normalizeSessionLeaseTtlMs(input: unknown): number | null {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return null;
  }
  const parsed = Math.floor(input);
  if (parsed <= 0) {
    return null;
  }
  return Math.max(MIN_SESSION_LEASE_TTL_MS, Math.min(parsed, MAX_SESSION_LEASE_TTL_MS));
}

export function normalizeSessionPolicy(input: unknown): SessionPolicy | null {
  if (input === "ephemeral" || input === "persistent") {
    return input;
  }
  return null;
}

export function defaultSessionPolicyForKind(kind: SessionState["kind"]): SessionPolicy {
  if (kind === "attached") {
    return "ephemeral";
  }
  return "persistent";
}

export function defaultSessionLeaseTtlMs(policy: SessionPolicy): number {
  if (policy === "ephemeral") {
    return DEFAULT_EPHEMERAL_SESSION_LEASE_TTL_MS;
  }
  return DEFAULT_SESSION_LEASE_TTL_MS;
}

export function leaseExpiryIso(anchorIso: string, ttlMs: number): string {
  const anchorMs = Date.parse(anchorIso);
  const baseMs = Number.isFinite(anchorMs) ? anchorMs : Date.now();
  return new Date(baseMs + ttlMs).toISOString();
}

export function withSessionHeartbeat(opts: {
  session: SessionState;
  observedAtIso?: string;
  defaultOwnerId: string | null;
  defaultLeaseTtlMs: number;
}): SessionState {
  const observedAtIso = typeof opts.observedAtIso === "string" && opts.observedAtIso.length > 0 ? opts.observedAtIso : nowIso();
  const policy = normalizeSessionPolicy(opts.session.policy) ?? defaultSessionPolicyForKind(opts.session.kind);
  const leaseTtlMs = normalizeSessionLeaseTtlMs(opts.session.leaseTtlMs) ?? opts.defaultLeaseTtlMs;
  const normalizedOwnerId = typeof opts.session.ownerId === "string" ? normalizeAgentId(opts.session.ownerId) : null;
  return {
    ...opts.session,
    policy,
    ownerId: normalizedOwnerId ?? opts.defaultOwnerId,
    leaseTtlMs,
    leaseExpiresAt: leaseExpiryIso(observedAtIso, leaseTtlMs),
    managedUnreachableSince: null,
    managedUnreachableCount: 0,
    lastSeenAt: observedAtIso,
  };
}

export function hasSessionLeaseExpired(session: SessionState, nowMs: number = Date.now()): boolean {
  if (typeof session.leaseExpiresAt !== "string" || session.leaseExpiresAt.length === 0) {
    return false;
  }
  const leaseMs = Date.parse(session.leaseExpiresAt);
  if (!Number.isFinite(leaseMs)) {
    return false;
  }
  return leaseMs <= nowMs;
}

