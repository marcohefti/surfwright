import { CliError } from "../../../errors.js";
import { readState } from "../../../state/index.js";
import type { SurfwrightState } from "../../../types.js";

type HandleType = "sessionId" | "targetId";

export function buildHandleTypeMismatchError(input: {
  expectedType: HandleType;
  providedHandle: string;
  detectedType: HandleType;
  correctedSessionId?: string | null;
  correctedTargetId?: string | null;
}): CliError {
  const message =
    input.expectedType === "sessionId"
      ? `Expected sessionId but received targetId handle: ${input.providedHandle}`
      : `Expected targetId but received sessionId handle: ${input.providedHandle}`;
  const nextCommand =
    input.expectedType === "sessionId"
      ? `surfwright target list --session ${input.correctedSessionId ?? "<sessionId>"}`
      : `surfwright target snapshot ${input.correctedTargetId ?? "<targetId>"} --session ${input.providedHandle}`;
  return new CliError("E_HANDLE_TYPE_MISMATCH", message, {
    hints: [
      input.expectedType === "sessionId"
        ? `Use --session ${input.correctedSessionId ?? "<sessionId>"} and reacquire targetId via \`target list\``
        : `Use targetId ${input.correctedTargetId ?? "<targetId>"} for target commands`,
      "sessionId and targetId are different handle types and are not interchangeable",
      "Use `surfwright contract --core --search target` to confirm command signatures",
    ],
    hintContext: {
      expectedType: input.expectedType,
      detectedType: input.detectedType,
      providedHandle: input.providedHandle,
      correctedSessionId: input.correctedSessionId ?? null,
      correctedTargetId: input.correctedTargetId ?? null,
    },
    recovery: {
      strategy: "swap-handle-type",
      nextCommand,
      requiredFields: ["sessionId", "targetId"],
      context: {
        expectedType: input.expectedType,
        providedHandle: input.providedHandle,
        correctedSessionId: input.correctedSessionId ?? null,
        correctedTargetId: input.correctedTargetId ?? null,
      },
    },
  });
}

export function fallbackSessionIdForTargetRecovery(snapshot: SurfwrightState): string | null {
  if (snapshot.activeSessionId && snapshot.sessions[snapshot.activeSessionId]) {
    return snapshot.activeSessionId;
  }
  const knownSessionIds = Object.keys(snapshot.sessions).sort((a, b) => a.localeCompare(b));
  if (knownSessionIds.length === 1) {
    return knownSessionIds[0];
  }
  return null;
}

export function buildSessionNotFoundError(opts: { sessionId: string; targetIdHint?: string | null }): CliError {
  const snapshot = readState();
  const knownTargetForSessionId = snapshot.targets[opts.sessionId];
  if (knownTargetForSessionId) {
    return buildHandleTypeMismatchError({
      expectedType: "sessionId",
      detectedType: "targetId",
      providedHandle: opts.sessionId,
      correctedSessionId: knownTargetForSessionId.sessionId,
      correctedTargetId: opts.sessionId,
    });
  }
  return new CliError("E_SESSION_NOT_FOUND", `Session ${opts.sessionId} not found`, {
    hints: [
      "Run `surfwright session list` to inspect active/known sessions",
      "If no suitable session exists, run `surfwright session ensure` (or `session new`)",
      "If this came from a stale target, reacquire targetId via `surfwright target list --session <id>`",
    ],
    hintContext: {
      requestedSessionId: opts.sessionId,
      activeSessionId: snapshot.activeSessionId ?? null,
      knownSessionCount: Object.keys(snapshot.sessions).length,
      targetHint: opts.targetIdHint ?? null,
    },
    recovery: {
      strategy: "reacquire-session",
      nextCommand: "surfwright session list",
      requiredFields: ["sessionId"],
      context: {
        requestedSessionId: opts.sessionId,
        targetHint: opts.targetIdHint ?? null,
      },
    },
  });
}

export function buildTargetSessionUnknownError(targetId: string): CliError {
  const snapshot = readState();
  const knownSession = snapshot.sessions[targetId];
  if (knownSession) {
    return buildHandleTypeMismatchError({
      expectedType: "targetId",
      detectedType: "sessionId",
      providedHandle: targetId,
      correctedSessionId: knownSession.sessionId,
    });
  }
  const activeSessionHint =
    snapshot.activeSessionId && snapshot.sessions[snapshot.activeSessionId]
      ? `Retry with explicit session: \`--session ${snapshot.activeSessionId}\``
      : null;
  return new CliError("E_TARGET_SESSION_UNKNOWN", `Target ${targetId} has no recorded session mapping`, {
    hints: [
      "Reacquire a live targetId with `surfwright target list --session <id>`",
      "If needed, open/reopen the page first with `surfwright open <url>`",
      activeSessionHint,
    ].filter((entry): entry is string => typeof entry === "string" && entry.length > 0),
    hintContext: {
      requestedTargetId: targetId,
      activeSessionId: snapshot.activeSessionId ?? null,
      knownTargetCount: Object.keys(snapshot.targets).length,
    },
    recovery: {
      strategy: "reacquire-target",
      nextCommand: "surfwright target list --session <id>",
      requiredFields: ["targetId", "sessionId"],
      context: {
        requestedTargetId: targetId,
        activeSessionId: snapshot.activeSessionId ?? null,
      },
    },
  });
}
