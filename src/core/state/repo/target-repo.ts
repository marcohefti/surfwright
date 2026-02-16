import { readState, upsertTargetState } from "../infra/state-store.js";
import type { TargetState } from "../../types.js";

const DEFAULT_RECENT_ACTION_WINDOW_MS = 2 * 60 * 1000;

export function readRecentTargetAction(opts: {
  targetId: string;
  sessionId: string;
  windowMs?: number;
}): string | null {
  const state = readState();
  const target = state.targets[opts.targetId];
  if (!target || target.sessionId !== opts.sessionId || !target.lastActionId || !target.lastActionAt) {
    return null;
  }
  const actionAtMs = Date.parse(target.lastActionAt);
  if (!Number.isFinite(actionAtMs)) {
    return null;
  }
  const windowMs = typeof opts.windowMs === "number" && opts.windowMs > 0 ? opts.windowMs : DEFAULT_RECENT_ACTION_WINDOW_MS;
  if (Date.now() - actionAtMs > windowMs) {
    return null;
  }
  return target.lastActionId;
}

export async function saveTargetSnapshot(target: TargetState) {
  await upsertTargetState(target);
}
