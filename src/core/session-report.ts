import type { SessionReport, SessionState } from "./types.js";

export function buildSessionReport(
  session: SessionState,
  meta: {
    active: boolean;
    created: boolean;
    restarted: boolean;
  },
): SessionReport {
  return {
    ok: true,
    sessionId: session.sessionId,
    kind: session.kind,
    cdpOrigin: session.cdpOrigin,
    active: meta.active,
    created: meta.created,
    restarted: meta.restarted,
  };
}
