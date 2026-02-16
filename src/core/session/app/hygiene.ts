import { DEFAULT_SESSION_LEASE_TTL_MS, type SessionPolicy, type SessionState } from "../../types.js";
import {
  defaultSessionLeaseTtlMs,
  defaultSessionPolicyForKind,
  hasSessionLeaseExpired,
  leaseExpiryIso,
  normalizeAgentId,
  normalizeSessionLeaseTtlMs,
  normalizeSessionPolicy,
  withSessionHeartbeat as withSessionHeartbeatPure,
} from "../domain/hygiene.js";
import { currentAgentIdFromEnv, sessionLeaseTtlMsFromEnv } from "../infra/session-env.js";

export {
  defaultSessionLeaseTtlMs,
  defaultSessionPolicyForKind,
  hasSessionLeaseExpired,
  leaseExpiryIso,
  normalizeAgentId,
  normalizeSessionLeaseTtlMs,
  normalizeSessionPolicy,
} from "../domain/hygiene.js";

export function currentAgentId(): string | null {
  return currentAgentIdFromEnv();
}

export function sessionLeaseTtlMs(): number {
  return sessionLeaseTtlMsFromEnv();
}

export function sessionDefaultLeaseTtlMs(policy: SessionPolicy): number {
  const envTtlMs = sessionLeaseTtlMs();
  if (envTtlMs === DEFAULT_SESSION_LEASE_TTL_MS) {
    return defaultSessionLeaseTtlMs(policy);
  }
  return envTtlMs;
}

export function withSessionHeartbeat(session: SessionState, observedAtIso?: string): SessionState {
  const policy = normalizeSessionPolicy(session.policy) ?? defaultSessionPolicyForKind(session.kind);
  const defaultLeaseTtlMs = sessionDefaultLeaseTtlMs(policy);
  return withSessionHeartbeatPure({
    session,
    observedAtIso,
    defaultOwnerId: currentAgentId(),
    defaultLeaseTtlMs,
  });
}

