export const SUPPORTED_STEP_IDS = new Set([
  "open",
  "list",
  "snapshot",
  "find",
  "count",
  "scroll-plan",
  "scrollPlan",
  "click",
  "click-read",
  "clickRead",
  "fill",
  "upload",
  "read",
  "eval",
  "wait",
  "extract",
]);

export type PipelineStepInput = {
  id: string;
  as?: string;
  assert?: {
    equals?: Record<string, unknown>;
    contains?: Record<string, unknown>;
    truthy?: unknown;
    exists?: unknown;
  };
  targetId?: string;
  url?: string;
  reuse?: string;
  timeoutMs?: number;
  kind?: string;
  text?: string;
  selector?: string;
  contains?: string;
  visibleOnly?: boolean;
  within?: string;
  frameScope?: string;
  steps?: string;
  settleMs?: number;
  countSelector?: string;
  countContains?: string;
  countVisibleOnly?: boolean;
  index?: number;
  nth?: number;
  first?: boolean;
  limit?: number;
  chunkSize?: number;
  chunk?: number;
  value?: string;
  events?: string;
  eventMode?: string;
  files?: string | string[];
  file?: string | string[];
  submitSelector?: string;
  expectUploadedFilename?: string;
  waitForResult?: boolean;
  resultSelector?: string;
  resultTextContains?: string;
  resultFilenameRegex?: string;
  waitTimeoutMs?: number;
  proof?: boolean;
  delta?: boolean;
  proofCheckState?: boolean;
  countAfter?: boolean;
  expectCountAfter?: number;
  assertUrlPrefix?: string;
  assertSelector?: string;
  assertText?: string;
  expression?: string;
  argJson?: string;
  captureConsole?: boolean;
  maxConsole?: number;
  forText?: string;
  forSelector?: string;
  networkIdle?: boolean;
  waitForText?: string;
  waitForSelector?: string;
  waitNetworkIdle?: boolean;
  readSelector?: string;
  readVisibleOnly?: boolean;
  readFrameScope?: string;
  snapshot?: boolean;
  noPersist?: boolean;
};

export type PipelineOps = {
  open: (opts: { url: string; timeoutMs: number; sessionId?: string; reuseModeInput?: string }) => Promise<Record<string, unknown>>;
  list: (opts: { timeoutMs: number; sessionId?: string; persistState: boolean }) => Promise<Record<string, unknown>>;
  snapshot: (opts: {
    targetId: string;
    timeoutMs: number;
    sessionId?: string;
    selectorQuery?: string;
    visibleOnly: boolean;
    frameScope?: string;
    persistState: boolean;
  }) => Promise<Record<string, unknown>>;
  find: (opts: {
    targetId: string;
    timeoutMs: number;
    sessionId?: string;
    textQuery?: string;
    selectorQuery?: string;
    containsQuery?: string;
    visibleOnly: boolean;
    first: boolean;
    limit?: number;
    persistState: boolean;
  }) => Promise<Record<string, unknown>>;
  count: (opts: {
    targetId: string;
    timeoutMs: number;
    sessionId?: string;
    textQuery?: string;
    selectorQuery?: string;
    containsQuery?: string;
    visibleOnly: boolean;
    frameScope?: string;
    persistState: boolean;
  }) => Promise<Record<string, unknown>>;
  scrollPlan: (opts: {
    targetId: string;
    timeoutMs: number;
    sessionId?: string;
    stepsCsv?: string;
    settleMs?: number;
    countSelectorQuery?: string;
    countContainsQuery?: string;
    countVisibleOnly: boolean;
    persistState: boolean;
  }) => Promise<Record<string, unknown>>;
  click: (opts: {
    targetId: string;
    timeoutMs: number;
    sessionId?: string;
    textQuery?: string;
    selectorQuery?: string;
    containsQuery?: string;
    visibleOnly: boolean;
    withinSelector?: string;
    frameScope?: string;
    index?: number;
    waitForText?: string;
    waitForSelector?: string;
    waitNetworkIdle: boolean;
    waitTimeoutMs?: number;
    snapshot: boolean;
    delta: boolean;
    proof: boolean;
    countAfter: boolean;
    expectCountAfter?: number;
    proofCheckState: boolean;
    assertUrlPrefix?: string;
    assertSelector?: string;
    assertText?: string;
    persistState: boolean;
  }) => Promise<Record<string, unknown>>;
  clickRead: (opts: {
    targetId: string;
    timeoutMs: number;
    sessionId?: string;
    textQuery?: string;
    selectorQuery?: string;
    containsQuery?: string;
    visibleOnly: boolean;
    frameScope?: string;
    index?: number;
    waitForText?: string;
    waitForSelector?: string;
    waitNetworkIdle: boolean;
    waitTimeoutMs?: number;
    readSelector?: string;
    readVisibleOnly: boolean;
    readFrameScope?: string;
    chunkSize?: number;
    chunkIndex?: number;
    persistState: boolean;
  }) => Promise<Record<string, unknown>>;
  fill: (opts: {
    targetId: string;
    timeoutMs: number;
    sessionId?: string;
    textQuery?: string;
    selectorQuery?: string;
    containsQuery?: string;
    visibleOnly: boolean;
    frameScope?: string;
    value: string;
    eventsInput?: string;
    eventModeInput?: string;
    waitForText?: string;
    waitForSelector?: string;
    waitNetworkIdle: boolean;
    waitTimeoutMs?: number;
    proof: boolean;
    assertUrlPrefix?: string;
    assertSelector?: string;
    assertText?: string;
    persistState: boolean;
  }) => Promise<Record<string, unknown>>;
  upload: (opts: {
    targetId: string;
    timeoutMs: number;
    sessionId?: string;
    selectorQuery: string;
    files: string[];
    submitSelector?: string;
    expectUploadedFilename?: string;
    waitForResult: boolean;
    resultSelector?: string;
    resultTextContains?: string;
    resultFilenameRegex?: string;
    waitForText?: string;
    waitForSelector?: string;
    waitNetworkIdle: boolean;
    waitTimeoutMs?: number;
    proof: boolean;
    assertUrlPrefix?: string;
    assertSelector?: string;
    assertText?: string;
    persistState: boolean;
  }) => Promise<Record<string, unknown>>;
  read: (opts: {
    targetId: string;
    timeoutMs: number;
    sessionId?: string;
    selectorQuery?: string;
    visibleOnly: boolean;
    frameScope?: string;
    chunkSize?: number;
    chunkIndex?: number;
    persistState: boolean;
  }) => Promise<Record<string, unknown>>;
  extract: (opts: {
    targetId: string;
    timeoutMs: number;
    sessionId?: string;
    kind?: string;
    selectorQuery?: string;
    visibleOnly: boolean;
    frameScope?: string;
    limit?: number;
    persistState: boolean;
  }) => Promise<Record<string, unknown>>;
  eval: (opts: {
    targetId: string;
    timeoutMs: number;
    sessionId?: string;
    expression?: string;
    argJson?: string;
    captureConsole?: boolean;
    maxConsole?: number;
    persistState: boolean;
  }) => Promise<Record<string, unknown>>;
  wait: (opts: {
    targetId: string;
    timeoutMs: number;
    sessionId?: string;
    forText?: string;
    forSelector?: string;
    networkIdle: boolean;
    persistState: boolean;
  }) => Promise<Record<string, unknown>>;
};

export type PipelineLintIssue = {
  level: "error" | "warning";
  path: string;
  message: string;
};

export type LoadedPlan = {
  source: string;
  replay: {
    path: string;
    recordedAt: string | null;
    label: string | null;
  } | null;
  plan: {
    steps: PipelineStepInput[];
  };
};
