import type { ActionTimingMs, SessionSource } from "../types.js";

export type TargetListReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targets: Array<{
    targetId: string;
    url: string;
    title: string;
    type: "page";
  }>;
  timingMs: ActionTimingMs;
};

export type TargetFramesReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  url: string;
  title: string;
  count: number;
  limit: number;
  frames: Array<{
    frameId: string;
    parentFrameId: string | null;
    depth: number;
    isMain: boolean;
    sameOrigin: boolean;
    url: string;
    name: string | null;
  }>;
  truncated: boolean;
  timingMs: ActionTimingMs;
};

export type TargetSnapshotMode = "snapshot" | "orient";

export type TargetSnapshotReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  mode: TargetSnapshotMode;
  cursor: string | null;
  nextCursor: string | null;
  url: string;
  title: string;
  scope: {
    selector: string | null;
    matched: boolean;
    visibleOnly: boolean;
    frameScope: "main" | "all";
  };
  textPreview: string;
  headings: string[];
  buttons: string[];
  links: Array<{
    text: string;
    href: string;
  }>;
  truncated: {
    text: boolean;
    headings: boolean;
    buttons: boolean;
    links: boolean;
  };
  h1?: string | null;
  items?: {
    headings: Array<{ index: number; text: string; selectorHint: string | null }>;
    buttons: Array<{ index: number; text: string; selectorHint: string | null }>;
    links: Array<{ index: number; text: string; href: string; selectorHint: string | null }>;
  };
  hints?: string[];
  timingMs: ActionTimingMs;
};

export type TargetPruneReport = {
  ok: true;
  activeSessionId: string | null;
  scanned: number;
  remaining: number;
  removed: number;
  removedOrphaned: number;
  removedByAge: number;
  removedByCap: number;
  maxAgeHours: number;
  maxPerSession: number;
};

export type TargetFindReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  mode: "text" | "selector";
  selector: string | null;
  contains: string | null;
  visibleOnly: boolean;
  first: boolean;
  query: string;
  count: number;
  limit: number;
  matches: Array<{
    index: number;
    text: string;
    visible: boolean;
    selectorHint: string | null;
  }>;
  truncated: boolean;
  timingMs: ActionTimingMs;
};

export type TargetClickReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  actionId: string;
  mode: "text" | "selector";
  selector: string | null;
  contains: string | null;
  visibleOnly: boolean;
  query: string;
  matchCount: number;
  pickedIndex: number;
  clicked: {
    index: number;
    text: string;
    visible: boolean;
    selectorHint: string | null;
  };
  url: string;
  title: string;
  wait: {
    mode: "text" | "selector" | "network-idle";
    value: string | null;
  } | null;
  snapshot: {
    textPreview: string;
  } | null;
  timingMs: ActionTimingMs;
};

export type TargetClickExplainReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  mode: "text" | "selector";
  selector: string | null;
  contains: string | null;
  visibleOnly: boolean;
  query: string;
  matchCount: number;
  requestedIndex: number | null;
  pickedIndex: number | null;
  picked: {
    index: number;
    text: string;
    visible: boolean;
    selectorHint: string | null;
  } | null;
  rejected: Array<{
    index: number;
    reason: "not_visible";
    visible: boolean;
    text: string;
    selectorHint: string | null;
  }>;
  rejectedTruncated: boolean;
  reason: "no_match" | "no_visible_match" | "index_out_of_range" | null;
  url: string;
  title: string;
  timingMs: ActionTimingMs;
};

export type TargetReadReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  url: string;
  title: string;
  scope: {
    selector: string | null;
    matched: boolean;
    visibleOnly: boolean;
    frameScope: "main" | "all";
  };
  chunkSize: number;
  chunkIndex: number;
  totalChunks: number;
  totalChars: number;
  text: string;
  truncated: boolean;
  hints?: string[];
  timingMs: ActionTimingMs;
};

export type TargetExtractReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  url: string;
  title: string;
  kind: "generic" | "blog" | "news" | "docs";
  source: "dom" | "api-feed";
  sourcesTried: string[];
  scope: {
    selector: string | null;
    matched: boolean;
    visibleOnly: boolean;
    frameScope: "main" | "all";
  };
  limit: number;
  count: number;
  items: Array<{
    index: number;
    title: string;
    url: string | null;
    summary: string | null;
    publishedAt: string | null;
    frameUrl: string;
  }>;
  truncated: boolean;
  hints: string[];
  timingMs: ActionTimingMs;
};

export type TargetEvalReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  actionId: string;
  expression: string;
  context: {
    frameCount: number;
    evaluatedFrameId: string;
    evaluatedFrameUrl: string;
    sameOrigin: boolean;
    world: "main";
  };
  result: {
    type: "undefined" | "null" | "boolean" | "number" | "string" | "bigint" | "array" | "object";
    value: unknown;
    truncated: boolean;
  };
  console: {
    captured: boolean;
    count: number;
    truncated: boolean;
    entries: Array<{
      level: string;
      text: string;
    }>;
  };
  timingMs: ActionTimingMs;
};

export type TargetWaitReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  url: string;
  title: string;
  mode: "text" | "selector" | "network-idle";
  value: string | null;
  timingMs: ActionTimingMs;
};

export type TargetUrlAssertReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  url: string;
  title: string;
  assert: { host: string | null; origin: string | null; pathPrefix: string | null; urlPrefix: string | null };
  timingMs: ActionTimingMs;
};

export type TargetConsoleTailReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  actionId: string | null;
  captureMs: number;
  maxEvents: number;
  seen: number;
  emitted: number;
  truncated: boolean;
  counts: { log: number; info: number; warn: number; error: number; debug: number; pageError: number; requestFailed: number };
};

export type TargetHealthReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  url: string;
  title: string;
  actionId: string | null;
  readyState: string;
  visibilityState: string;
  metrics: {
    readyState: string;
    visibilityState: string;
    frameCount: number;
    domNodes: number;
    headings: number;
    buttons: number;
    links: number;
    forms: number;
    scripts: number;
    images: number;
  };
  checks: Array<{ id: string; ok: boolean; actual: string | number; expected: string }>;
  hints: string[];
  timingMs: { total: number; resolveSession: number; connectCdp: number; action: number };
};

export type TargetHudReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  url: string;
  title: string;
  actionId: string | null;
  panels: {
    readiness: { readyState: string; visibilityState: string; checksPassed: number; checksTotal: number };
    content: { frameCount: number; domNodes: number; headings: number; buttons: number; links: number; forms: number; images: number };
    hints: string[];
  };
  timingMs: TargetHealthReport["timingMs"];
};

