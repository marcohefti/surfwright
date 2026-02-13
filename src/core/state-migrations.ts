import { STATE_VERSION } from "./types.js";

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
