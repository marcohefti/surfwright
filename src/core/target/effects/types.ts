import type { ActionTimingMs, SessionSource } from "../../types.js";

export type TargetObservedElement = {
  index: number;
  text: string;
  visible: boolean;
  selectorHint: string | null;
};

export type TargetObservedQuery = {
  selector: string;
  contains: string | null;
  visibleOnly: boolean;
};

export type TargetTransitionEvent = {
  kind: string;
  propertyName: string | null;
  animationName: string | null;
  elapsedMs: number | null;
  selector: string | null;
  text: string | null;
  scrollY: number;
  timeMs: number;
};

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
  events: TargetTransitionEvent[];
  timingMs: ActionTimingMs;
};

export type TargetObserveReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  actionId: string;
  query: TargetObservedQuery;
  observed: TargetObservedElement;
  property: string;
  intervalMs: number;
  durationMs: number;
  maxSamples: number;
  sampleCount: number;
  samples: Array<{
    index: number;
    timeMs: number;
    value: string | null;
    scrollY: number;
  }>;
  changes: number;
  firstValue: string | null;
  lastValue: string | null;
  timingMs: ActionTimingMs;
};

export type TargetScrollSampleReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  actionId: string;
  query: TargetObservedQuery;
  observed: TargetObservedElement;
  property: string;
  settleMs: number;
  maxScroll: number;
  viewport: { width: number; height: number };
  steps: Array<{
    index: number;
    requestedY: number;
    appliedY: number;
    achievedY: number;
    deltaY: number;
    value: string | null;
  }>;
  valueChanges: number;
  timingMs: ActionTimingMs;
};

export type TargetScrollWatchReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  actionId: string;
  query: TargetObservedQuery;
  observed: TargetObservedElement;
  properties: string[];
  settleMs: number;
  maxEvents: number;
  maxScroll: number;
  viewport: { width: number; height: number };
  samples: Array<{
    index: number;
    requestedY: number;
    appliedY: number;
    achievedY: number;
    deltaY: number;
    className: string;
    rectTop: number | null;
    rectBottom: number | null;
    rectHeight: number | null;
    computed: Record<string, string | null>;
  }>;
  changes: Array<{
    fromIndex: number;
    toIndex: number;
    fromScrollY: number;
    toScrollY: number;
    classAdded: string[];
    classRemoved: string[];
    propertyChanges: Array<{
      property: string;
      from: string | null;
      to: string | null;
    }>;
  }>;
  changeCount: number;
  transition: {
    eventCount: number;
    emitted: number;
    dropped: number;
    truncated: boolean;
    countsByKind: Record<string, number>;
    events: TargetTransitionEvent[];
  };
  timingMs: ActionTimingMs;
};

export type TargetHoverReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  actionId: string;
  query: {
    mode: "text" | "selector";
    query: string;
    selector: string | null;
    contains: string | null;
    visibleOnly: boolean;
  };
  hovered: TargetObservedElement;
  properties: string[];
  settleMs: number;
  before: Record<string, string | null>;
  after: Record<string, string | null>;
  diffs: Array<{
    property: string;
    before: string | null;
    after: string | null;
  }>;
  changedCount: number;
  timingMs: ActionTimingMs;
};

export type TargetStyleReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  actionId: string;
  query: {
    mode: "text" | "selector";
    query: string;
    selector: string | null;
    contains: string | null;
    visibleOnly: boolean;
  };
  matchCount: number;
  pickedIndex: number;
  inspected: TargetObservedElement & {
    tagName: string | null;
    id: string | null;
    className: string | null;
  };
  properties: string[];
  values: Record<string, string | null>;
  proof?: {
    action: "style";
    queryMode: "text" | "selector";
    query: string;
    selector: string | null;
    pickedIndex: number;
    inspectedText: string;
    inspectedSelectorHint: string | null;
    values: Record<string, string | null>;
  };
  timingMs: ActionTimingMs;
};

export type TargetStickyCheckReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  actionId: string;
  selector: string;
  contains: string | null;
  visibleOnly: boolean;
  stepsCsv: string;
  settleMs: number;
  sticky: boolean;
  evidence: {
    positions: Array<string | null>;
    topDriftPx: number | null;
    scrollRangePx: number;
    changeCount: number;
    transitionEvents: number;
  };
  samples: Array<{
    index: number;
    achievedY: number;
    rectTop: number | null;
    position: string | null;
    top: string | null;
  }>;
  timingMs: ActionTimingMs;
};

export type TargetMotionDetectReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  actionId: string;
  query: TargetObservedQuery;
  observed: TargetObservedElement;
  property: string;
  intervalMs: number;
  durationMs: number;
  maxSamples: number;
  sampleCount: number;
  changes: number;
  uniqueValues: number;
  firstValue: string | null;
  lastValue: string | null;
  motionDetected: boolean;
  samples: Array<{
    index: number;
    timeMs: number;
    value: string | null;
    scrollY: number;
  }>;
  timingMs: ActionTimingMs;
};

export type TargetTransitionAssertReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  actionId: string;
  cycles: number;
  asserted: boolean;
  totalEvents: number;
  totalDropped: number;
  countsByKind: Record<string, number>;
  runs: Array<{
    cycle: number;
    eventCount: number;
    emitted: number;
    dropped: number;
    truncated: boolean;
    countsByKind: Record<string, number>;
    trigger: TargetTransitionTraceReport["trigger"];
  }>;
  timingMs: ActionTimingMs;
};

export type TargetScrollRevealScanReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  actionId: string;
  selectorQuery: string | null;
  containsQuery: string | null;
  visibleOnly: boolean;
  stepsCsv: string;
  settleMs: number;
  maxCandidates: number;
  scannedCount: number;
  revealedCount: number;
  candidates: Array<{
    selector: string;
    revealDetected: boolean;
    changeCount: number;
    transitionEvents: number;
    first: {
      opacity: string | null;
      transform: string | null;
      visibility: string | null;
      scrollY: number;
    } | null;
    last: {
      opacity: string | null;
      transform: string | null;
      visibility: string | null;
      scrollY: number;
    } | null;
    error: string | null;
  }>;
  timingMs: ActionTimingMs;
};
