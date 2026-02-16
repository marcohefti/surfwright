import { readState } from "../../state.js";
import type { SessionState } from "../../types.js";

export function listSessionsSnapshot(): {
  activeSessionId: string | null;
  sessions: SessionState[];
} {
  const state = readState();
  const sessions = Object.values(state.sessions).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  return {
    activeSessionId: state.activeSessionId,
    sessions,
  };
}
