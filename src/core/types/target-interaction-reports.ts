import type { ActionAssertionReport, ActionProofEnvelope, ActionTimingMs, DownloadCaptureReport, SessionSource } from "../types.js";

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

export type TargetSnapshotMode = "snapshot" | "orient" | "a11y";

export type TargetSnapshotA11yRow = {
  index: number;
  depth: number;
  role: string;
  name: string;
  handle: string | null;
  value?: string | null;
  description?: string | null;
};

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
  headingsCount?: number;
  buttonsCount?: number;
  linksCount?: number;
  navCount?: number;
  countScope?: "full" | "bounded";
  countFilter?: Array<"headings" | "buttons" | "links" | "nav">;
  truncated: {
    text: boolean;
    headings: boolean;
    buttons: boolean;
    links: boolean;
  };
  a11y?: {
    total: number;
    rows: TargetSnapshotA11yRow[];
    truncated: boolean;
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
  hrefHost: string | null;
  hrefPathPrefix: string | null;
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
    href: string | null;
    tag: string | null;
  }>;
  truncated: boolean;
  timingMs: ActionTimingMs;
};

export type TargetCountReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  mode: "text" | "selector";
  selector: string | null;
  contains: string | null;
  visibleOnly: boolean;
  query: string;
  rawCount: number;
  count: number;
  timingMs: ActionTimingMs;
};

export type TargetClickDeltaRole = "dialog" | "alert" | "status" | "menu" | "listbox";

export type TargetClickDeltaEvidence = {
  before: {
    url: string;
    title: string;
    focus: {
      selectorHint: string | null;
      text: string | null;
      textTruncated: boolean;
    };
    roleCounts: Record<TargetClickDeltaRole, number>;
  };
  after: {
    url: string;
    title: string;
    focus: {
      selectorHint: string | null;
      text: string | null;
      textTruncated: boolean;
    };
    roleCounts: Record<TargetClickDeltaRole, number>;
  };
  clickedAria: {
    detachedAfter: boolean;
    attributes: Array<{ name: string; before: string | null; after: string | null }>;
  };
};

export type TargetClickReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  actionId: string;
  mode: "text" | "selector" | "handle";
  selector: string | null;
  contains: string | null;
  visibleOnly: boolean;
  withinSelector?: string | null;
  query: string;
  matchCount: number;
  pickedIndex: number;
  clicked: {
    index: number;
    text: string;
    visible: boolean;
    selectorHint: string | null;
    handle?: string | null;
  };
  url: string;
  title: string;
  wait: {
    mode: "text" | "selector" | "network-idle";
    value: string | null;
    timeoutMs: number;
    elapsedMs: number;
    satisfied: boolean;
  } | null;
  snapshot: {
    textPreview: string;
  } | null;
  countAfter?: number | null;
  proof?: {
    urlChanged: boolean;
    targetChanged: boolean;
    waitSatisfied: boolean;
    snapshotCaptured: boolean;
    deltaCaptured: boolean;
    clickedText: string;
    clickedSelectorHint: string | null;
    finalUrl: string;
    openedTargetId: string | null;
    countAfter: number | null;
    checkState?: {
      before: {
        checked: boolean | null;
        ariaChecked: string | null;
      };
      after: {
        checked: boolean | null;
        ariaChecked: string | null;
      };
      changed: boolean | null;
    };
  };
  proofEnvelope?: ActionProofEnvelope;
  assertions?: ActionAssertionReport | null;
  delta?: TargetClickDeltaEvidence;
  repeat?: {
    requested: number;
    completed: number;
    actionIds: string[];
    pickedIndices: number[];
  };
  handoff: {
    sameTarget: boolean;
    openedTargetId: string | null;
    openedUrl: string | null;
    openedTitle: string | null;
  };
  timingMs: ActionTimingMs;
};

export type TargetDownloadReport = {
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
  sourceUrl: string | null;
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
  downloadStarted: boolean;
  downloadMethod: "event" | "fetch-fallback" | "none";
  downloadStatus: number | null;
  downloadFinalUrl: string | null;
  downloadFileName: string | null;
  downloadBytes: number | null;
  downloadedFilename: string | null;
  downloadedBytes: number | null;
  download: DownloadCaptureReport | null;
  failureReason?: string | null;
  proof?: {
    downloadStarted: boolean;
    downloadMethod: "event" | "fetch-fallback" | "none";
    fileName: string | null;
    path: string | null;
    bytes: number | null;
    mime: string | null;
    sourceUrl: string | null;
    failureReason?: string | null;
  };
  proofEnvelope?: ActionProofEnvelope;
  assertions?: ActionAssertionReport | null;
  timingMs: ActionTimingMs;
};

export type TargetSnapshotDiffReport = {
  ok: true;
  a: {
    path: string;
    url: string;
    title: string;
    mode: TargetSnapshotMode;
    counts: { headings: number; buttons: number; links: number };
  };
  b: {
    path: string;
    url: string;
    title: string;
    mode: TargetSnapshotMode;
    counts: { headings: number; buttons: number; links: number };
  };
  changed: {
    url: boolean;
    title: boolean;
    textPreview: boolean;
    headings: boolean;
    buttons: boolean;
    links: boolean;
  };
  delta: {
    headings: { added: string[]; removed: string[]; truncated: boolean };
    buttons: { added: string[]; removed: string[]; truncated: boolean };
    links: { added: Array<{ text: string; href: string }>; removed: Array<{ text: string; href: string }>; truncated: boolean };
  };
};
