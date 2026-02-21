import type { SessionSource } from "../types.js";

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
