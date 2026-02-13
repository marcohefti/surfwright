export const DEFAULT_SESSION_ID = "s-default";
export const DEFAULT_OPEN_TIMEOUT_MS = 20000;
export const DEFAULT_SESSION_TIMEOUT_MS = 12000;
export const DEFAULT_TARGET_TIMEOUT_MS = 10000;
export const DEFAULT_TARGET_FIND_LIMIT = 12;
export const DEFAULT_TARGET_READ_CHUNK_SIZE = 1200;
export const DEFAULT_TARGET_NETWORK_CAPTURE_MS = 2500;
export const DEFAULT_TARGET_NETWORK_MAX_REQUESTS = 120;
export const DEFAULT_TARGET_NETWORK_MAX_WEBSOCKETS = 24;
export const DEFAULT_TARGET_NETWORK_MAX_WS_MESSAGES = 120;
export const STATE_VERSION = 2;

export type DoctorReport = {
  ok: boolean;
  node: {
    version: string;
    platform: NodeJS.Platform;
    arch: string;
  };
  chrome: {
    found: boolean;
    candidates: string[];
  };
};

export type SessionKind = "managed" | "attached";

export type OpenReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  url: string;
  status: number | null;
  title: string;
};

export type SessionReport = {
  ok: true;
  sessionId: string;
  kind: SessionKind;
  cdpOrigin: string;
  active: boolean;
  created: boolean;
  restarted: boolean;
};

export type SessionListReport = {
  ok: true;
  activeSessionId: string | null;
  sessions: Array<{
    sessionId: string;
    kind: SessionKind;
    cdpOrigin: string;
    lastSeenAt: string;
  }>;
};

export type SessionPruneReport = {
  ok: true;
  activeSessionId: string | null;
  scanned: number;
  kept: number;
  removed: number;
  removedAttachedUnreachable: number;
  removedManagedUnreachable: number;
  repairedManagedPid: number;
};

export type TargetListReport = {
  ok: true;
  sessionId: string;
  targets: Array<{
    targetId: string;
    url: string;
    title: string;
    type: "page";
  }>;
};

export type TargetSnapshotReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  url: string;
  title: string;
  scope: {
    selector: string | null;
    matched: boolean;
    visibleOnly: boolean;
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
};

export type TargetReadReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  url: string;
  title: string;
  scope: {
    selector: string | null;
    matched: boolean;
    visibleOnly: boolean;
  };
  chunkSize: number;
  chunkIndex: number;
  totalChunks: number;
  totalChars: number;
  text: string;
  truncated: boolean;
};

export type TargetWaitReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  url: string;
  title: string;
  mode: "text" | "selector" | "network-idle";
  value: string | null;
};

export type TargetNetworkRequestReport = {
  id: number;
  url: string;
  method: string;
  resourceType: string;
  navigation: boolean;
  startMs: number;
  endMs: number | null;
  durationMs: number | null;
  ttfbMs: number | null;
  status: number | null;
  ok: boolean | null;
  failure: string | null;
  bytesApprox: number | null;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  postDataPreview?: string | null;
};

export type TargetNetworkWebSocketMessageReport = {
  direction: "sent" | "received";
  atMs: number;
  opcode: number | null;
  sizeBytes: number;
  preview: string;
};

export type TargetNetworkWebSocketReport = {
  id: number;
  url: string;
  startMs: number;
  closeMs: number | null;
  durationMs: number | null;
  closed: boolean;
  error: string | null;
  messageCount: number;
  messages: TargetNetworkWebSocketMessageReport[];
};

export type TargetNetworkHarReport = {
  path: string;
  mode: "minimal";
  scope: "filtered";
  entries: number;
  bytes: number;
  writtenAt: string;
};

export type TargetNetworkReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  url: string;
  title: string;
  capture: {
    startedAt: string;
    endedAt: string;
    durationMs: number;
    captureMs: number;
    reload: boolean;
  };
  filters: {
    urlContains: string | null;
    method: string | null;
    resourceType: string | null;
    status: string | null;
    failedOnly: boolean;
  };
  limits: {
    maxRequests: number;
    maxWebSockets: number;
    maxWsMessages: number;
  };
  counts: {
    requestsSeen: number;
    requestsReturned: number;
    responsesSeen: number;
    failedSeen: number;
    webSocketsSeen: number;
    webSocketsReturned: number;
    wsMessagesSeen: number;
    wsMessagesReturned: number;
    droppedRequests: number;
    droppedWebSockets: number;
    droppedWsMessages: number;
  };
  performance: {
    completedRequests: number;
    bytesApproxTotal: number;
    statusBuckets: {
      "2xx": number;
      "3xx": number;
      "4xx": number;
      "5xx": number;
      other: number;
    };
    latencyMs: {
      min: number | null;
      max: number | null;
      avg: number | null;
      p50: number | null;
      p95: number | null;
    };
    ttfbMs: {
      min: number | null;
      max: number | null;
      avg: number | null;
      p50: number | null;
      p95: number | null;
    };
    slowest: Array<{
      id: number;
      url: string;
      resourceType: string;
      status: number | null;
      durationMs: number;
    }>;
  };
  truncated: {
    requests: boolean;
    webSockets: boolean;
    wsMessages: boolean;
  };
  har?: TargetNetworkHarReport;
  requests: TargetNetworkRequestReport[];
  webSockets: TargetNetworkWebSocketReport[];
};

export type StateReconcileReport = {
  ok: true;
  activeSessionId: string | null;
  sessions: {
    scanned: number;
    kept: number;
    removed: number;
    removedAttachedUnreachable: number;
    removedManagedUnreachable: number;
    repairedManagedPid: number;
  };
  targets: {
    scanned: number;
    remaining: number;
    removed: number;
    removedOrphaned: number;
    removedByAge: number;
    removedByCap: number;
    maxAgeHours: number;
    maxPerSession: number;
  };
};

export type CliFailure = {
  ok: false;
  code: string;
  message: string;
};

export type SessionState = {
  sessionId: string;
  kind: SessionKind;
  cdpOrigin: string;
  debugPort: number | null;
  userDataDir: string | null;
  browserPid: number | null;
  createdAt: string;
  lastSeenAt: string;
};

export type TargetState = {
  targetId: string;
  sessionId: string;
  url: string;
  title: string;
  status: number | null;
  updatedAt: string;
};

export type SurfwrightState = {
  version: number;
  activeSessionId: string | null;
  nextSessionOrdinal: number;
  sessions: Record<string, SessionState>;
  targets: Record<string, TargetState>;
};

export type CliCommandContract = {
  id: string;
  usage: string;
  summary: string;
};

export type CliErrorContract = {
  code: string;
  message: string;
  retryable: boolean;
};

export type CliContractReport = {
  ok: true;
  name: string;
  version: string;
  guarantees: string[];
  commands: CliCommandContract[];
  errors: CliErrorContract[];
};
