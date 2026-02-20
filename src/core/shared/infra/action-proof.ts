import type { ActionAssertionReport, ActionProofEnvelope, ActionWaitEvidence } from "../../types.js";

type WaitInput = {
  mode: "text" | "selector" | "network-idle";
  value: string | null;
  timeoutMs: number;
  elapsedMs: number;
  satisfied: boolean;
} | null;

export function toActionWaitEvidence(opts: {
  requested: {
    mode: "text" | "selector" | "network-idle";
    value: string | null;
    timeoutMs: number;
  } | null;
  observed: WaitInput;
}): ActionWaitEvidence {
  if (!opts.requested) {
    return {
      requested: false,
      mode: null,
      value: null,
      timeoutMs: null,
      elapsedMs: null,
      satisfied: true,
    };
  }
  return {
    requested: true,
    mode: opts.observed?.mode ?? opts.requested.mode,
    value: opts.observed?.value ?? opts.requested.value,
    timeoutMs: opts.observed?.timeoutMs ?? opts.requested.timeoutMs,
    elapsedMs: opts.observed?.elapsedMs ?? null,
    satisfied: opts.observed?.satisfied ?? false,
  };
}

export function buildActionProofEnvelope(opts: {
  action: string;
  urlBefore: string | null;
  urlAfter: string | null;
  targetBefore: string | null;
  targetAfter: string | null;
  matchCount?: number | null;
  pickedIndex?: number | null;
  wait: ActionWaitEvidence;
  assertions?: ActionAssertionReport | null;
  countAfter?: number | null;
  details?: Record<string, unknown> | null;
}): ActionProofEnvelope {
  const urlChanged =
    typeof opts.urlBefore === "string" &&
    typeof opts.urlAfter === "string" &&
    opts.urlBefore !== opts.urlAfter;
  const targetChanged =
    typeof opts.targetBefore === "string" &&
    typeof opts.targetAfter === "string" &&
    opts.targetBefore !== opts.targetAfter;
  return {
    version: 1,
    action: opts.action,
    urlBefore: opts.urlBefore,
    urlAfter: opts.urlAfter,
    urlChanged,
    targetBefore: opts.targetBefore,
    targetAfter: opts.targetAfter,
    targetChanged,
    matchCount: typeof opts.matchCount === "number" ? opts.matchCount : null,
    pickedIndex: typeof opts.pickedIndex === "number" ? opts.pickedIndex : null,
    wait: opts.wait,
    assertions: opts.assertions ?? null,
    countAfter: typeof opts.countAfter === "number" ? opts.countAfter : null,
    details: opts.details ?? null,
  };
}
