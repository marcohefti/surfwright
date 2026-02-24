import type { ActionTimingMs, SessionSource } from "../types.js";

export type TargetAttrReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  mode: "text" | "selector";
  selector: string | null;
  contains: string | null;
  visibleOnly: boolean;
  query: string;
  frameScope: "main" | "all";
  attribute: string;
  requestedIndex: number;
  matchCount: number;
  pickedIndex: number;
  attributePresent: boolean;
  value: string | null;
  picked: {
    index: number;
    frameId: string;
    text: string;
    visible: boolean;
    selectorHint: string | null;
    tag: string | null;
  };
  timingMs: ActionTimingMs;
};
