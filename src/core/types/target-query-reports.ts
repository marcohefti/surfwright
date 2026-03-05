import type { ActionAssertionReport, ActionTimingMs, SessionSource } from "../types.js";

export type TargetClickExplainReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  mode: "text" | "selector";
  selector: string | null;
  contains: string | null;
  visibleOnly: boolean;
  withinSelector?: string | null;
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
  kind: "generic" | "blog" | "news" | "docs" | "docs-commands" | "command-lines" | "headings" | "links" | "codeblocks" | "forms" | "tables" | "table-rows";
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
    language?: string | null;
    command?: string | null;
    section?: string | null;
    record?: Record<string, string | null>;
    actionable?: {
      handle: string | null;
      selectorHint: string | null;
      frameId: string | null;
      href: string | null;
    };
  }>;
  schema?: {
    fields: Record<string, string>;
    dedupeBy: string[];
  };
  records?: Array<Record<string, string | null>>;
  summary?: {
    count: number;
    itemCount: number;
    totalRawCount: number;
    truncated: boolean;
    firstTitle: string | null;
    firstUrl: string | null;
    firstCommand: string | null;
    source: "dom" | "api-feed";
  };
  proof?: {
    count: number;
    itemCount: number;
    totalRawCount: number;
    truncated: boolean;
    firstTitle: string | null;
    firstUrl: string | null;
    firstCommand: string | null;
    source: "dom" | "api-feed";
  };
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
  wait: {
    mode: "text" | "selector" | "network-idle";
    value: string | null;
    timeoutMs: number;
    elapsedMs: number;
    satisfied: boolean;
  };
  assertions?: ActionAssertionReport | null;
  timingMs: ActionTimingMs;
};

export type TargetUrlAssertReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  url: string;
  title: string;
  blockType: "auth" | "captcha" | "consent" | "unknown";
  assert: { host: string | null; origin: string | null; pathPrefix: string | null; urlPrefix: string | null };
  timingMs: ActionTimingMs;
};
