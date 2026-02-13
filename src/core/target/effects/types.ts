import type { ActionTimingMs, SessionSource } from "../../types.js";

export type TargetScrollPlanReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  actionId: string;
  settleMs: number;
  maxScroll: number;
  viewport: { width: number; height: number };
  steps: Array<{ index: number; requestedY: number; appliedY: number; achievedY: number; deltaY: number }>;
  timingMs: ActionTimingMs;
};

export type TargetTransitionTraceReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  actionId: string;
  captureMs: number;
  maxEvents: number;
  trigger: {
    mode: "text" | "selector";
    query: string;
    selector: string | null;
    contains: string | null;
    visibleOnly: boolean;
    clicked: { index: number; text: string; visible: boolean; selectorHint: string | null };
  } | null;
  eventCount: number;
  emitted: number;
  dropped: number;
  truncated: boolean;
  countsByKind: Record<string, number>;
  events: Array<{
    kind: string;
    propertyName: string | null;
    animationName: string | null;
    elapsedMs: number | null;
    selector: string | null;
    text: string | null;
    scrollY: number;
    timeMs: number;
  }>;
  timingMs: ActionTimingMs;
};
