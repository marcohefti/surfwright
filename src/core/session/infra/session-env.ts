import { DEFAULT_SESSION_LEASE_TTL_MS } from "../../types.js";
import { providers } from "../../providers/index.js";
import { normalizeAgentId, normalizeSessionLeaseTtlMs } from "../domain/hygiene.js";

export function currentAgentIdFromEnv(): string | null {
  const raw = providers().env.get("SURFWRIGHT_AGENT_ID");
  if (typeof raw !== "string") {
    return null;
  }
  return normalizeAgentId(raw);
}

export function sessionLeaseTtlMsFromEnv(): number {
  const raw = providers().env.get("SURFWRIGHT_SESSION_LEASE_TTL_MS");
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return DEFAULT_SESSION_LEASE_TTL_MS;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  return normalizeSessionLeaseTtlMs(parsed) ?? DEFAULT_SESSION_LEASE_TTL_MS;
}

