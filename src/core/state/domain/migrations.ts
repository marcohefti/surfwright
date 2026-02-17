import { DEFAULT_EPHEMERAL_SESSION_LEASE_TTL_MS, DEFAULT_SESSION_LEASE_TTL_MS, STATE_VERSION } from "../../types.js";

type StateEnvelope = Record<string, unknown>;
type Migration = (state: StateEnvelope) => StateEnvelope;

function asStateEnvelope(value: unknown): StateEnvelope | null {
  return typeof value === "object" && value !== null ? { ...(value as Record<string, unknown>) } : null;
}

function parseVersion(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const parsed = Math.floor(value);
  return parsed >= 1 ? parsed : null;
}

function asStateRecord(value: unknown): StateEnvelope | null {
  return typeof value === "object" && value !== null ? (value as StateEnvelope) : null;
}

function asPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const parsed = Math.floor(value);
  return parsed > 0 ? parsed : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const parsed = Math.floor(value);
  return parsed >= 0 ? parsed : null;
}

function normalizeSessionPolicy(input: unknown, kind: string): "ephemeral" | "persistent" {
  if (input === "ephemeral" || input === "persistent") {
    return input;
  }
  if (kind === "attached") {
    return "ephemeral";
  }
  return "persistent";
}

const MIGRATIONS = new Map<number, Migration>([
  [
    1,
    (state) => ({
      ...state,
      version: 2,
      nextCaptureOrdinal: typeof state.nextCaptureOrdinal === "number" ? state.nextCaptureOrdinal : 1,
      nextArtifactOrdinal: typeof state.nextArtifactOrdinal === "number" ? state.nextArtifactOrdinal : 1,
      networkCaptures:
        typeof state.networkCaptures === "object" && state.networkCaptures !== null ? state.networkCaptures : {},
      networkArtifacts:
        typeof state.networkArtifacts === "object" && state.networkArtifacts !== null ? state.networkArtifacts : {},
    }),
  ],
  [
    2,
    (state) => {
      const rawSessions = asStateRecord(state.sessions) ?? {};
      const sessions = Object.fromEntries(
        Object.entries(rawSessions).map(([sessionId, rawSession]) => {
          const parsedSession = asStateRecord(rawSession);
          if (!parsedSession) {
            return [sessionId, rawSession];
          }
          const kind = parsedSession.kind === "attached" ? "attached" : "managed";
          const policy = normalizeSessionPolicy(parsedSession.policy, kind);
          const defaultLeaseTtlMs =
            policy === "ephemeral" ? DEFAULT_EPHEMERAL_SESSION_LEASE_TTL_MS : DEFAULT_SESSION_LEASE_TTL_MS;
          return [
            sessionId,
            {
              ...parsedSession,
              policy,
              leaseTtlMs: asPositiveInteger(parsedSession.leaseTtlMs) ?? defaultLeaseTtlMs,
              managedUnreachableSince:
                typeof parsedSession.managedUnreachableSince === "string" && parsedSession.managedUnreachableSince.length > 0
                  ? parsedSession.managedUnreachableSince
                  : null,
              managedUnreachableCount: asNonNegativeInteger(parsedSession.managedUnreachableCount) ?? 0,
            },
          ];
        }),
      );
      return {
        ...state,
        version: 3,
        sessions,
      };
    },
  ],
  [
    3,
    (state) => {
      const rawSessions = asStateRecord(state.sessions) ?? {};
      const sessions = Object.fromEntries(
        Object.entries(rawSessions).map(([sessionId, rawSession]) => {
          const parsedSession = asStateRecord(rawSession);
          if (!parsedSession) {
            return [sessionId, rawSession];
          }
          const kind = parsedSession.kind === "attached" ? "attached" : "managed";
          const profile =
            kind === "managed" && typeof parsedSession.profile === "string" && parsedSession.profile.trim().length > 0
              ? parsedSession.profile.trim()
              : null;
          return [
            sessionId,
            {
              ...parsedSession,
              profile,
            },
          ];
        }),
      );
      return {
        ...state,
        version: 4,
        sessions,
      };
    },
  ],
]);

export function migrateStatePayload(raw: unknown): StateEnvelope | null {
  const envelope = asStateEnvelope(raw);
  if (!envelope) {
    return null;
  }

  let version = parseVersion(envelope.version) ?? 1;
  let state = envelope;

  while (version < STATE_VERSION) {
    const migration = MIGRATIONS.get(version);
    if (!migration) {
      return null;
    }
    state = migration(state);
    version = parseVersion(state.version) ?? version + 1;
  }

  return {
    ...state,
    version: STATE_VERSION,
  };
}
