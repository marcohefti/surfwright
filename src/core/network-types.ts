export type TargetNetworkRequestReport = {
  id: number;
  captureKey: string;
  actionId: string | null;
  redirectedFromId: number | null;
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
  captureKey: string;
  actionId: string | null;
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
  captureId: string | null;
  actionId: string | null;
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
    profile: "custom" | "api" | "page" | "ws" | "perf";
  };
  view: "raw" | "summary" | "table";
  fields: string[];
  tableRows: Array<Record<string, string | number | boolean | null>>;
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
  hints: {
    shouldRecapture: boolean;
    suggested: {
      maxRequests: number;
      maxWebSockets: number;
      maxWsMessages: number;
    };
  };
  insights: {
    topHosts: Array<{
      host: string;
      requests: number;
      failures: number;
      avgLatencyMs: number | null;
    }>;
    errorHotspots: Array<{
      url: string;
      failures: number;
      status4xx: number;
      status5xx: number;
    }>;
    websocketHotspots: Array<{
      url: string;
      messages: number;
      durationMs: number | null;
    }>;
  };
  requests: TargetNetworkRequestReport[];
  webSockets: TargetNetworkWebSocketReport[];
};

export type TargetNetworkExportReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  url: string;
  title: string;
  format: "har";
  artifact: TargetNetworkHarReport;
  source: {
    captureMs: number;
    requestsSeen: number;
    requestsReturned: number;
    truncatedRequests: boolean;
  };
};

export type TargetNetworkCaptureStatus = "recording" | "stopped" | "failed";

export type TargetNetworkCaptureBeginReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  captureId: string;
  actionId: string;
  status: TargetNetworkCaptureStatus;
  profile: "custom" | "api" | "page" | "ws" | "perf";
  startedAt: string;
  maxRuntimeMs: number;
};

export type TargetNetworkCaptureEndReport = TargetNetworkReport & {
  status: TargetNetworkCaptureStatus;
};

export type TargetNetworkArtifactListReport = {
  ok: true;
  total: number;
  returned: number;
  artifacts: Array<{
    artifactId: string;
    createdAt: string;
    format: "har";
    path: string;
    sessionId: string;
    targetId: string;
    captureId: string | null;
    entries: number;
    bytes: number;
  }>;
};

export type TargetNetworkArtifactPruneReport = {
  ok: true;
  totalBefore: number;
  totalAfter: number;
  removed: number;
  removedMissingFiles: number;
  removedByAge: number;
  removedByCount: number;
  removedBySize: number;
  maxAgeHours: number | null;
  maxCount: number | null;
  maxTotalBytes: number | null;
  deleteFiles: boolean;
};

export type TargetNetworkQueryPreset = "summary" | "slowest" | "errors" | "largest" | "ws-hotspots";

export type TargetNetworkQueryReport = {
  ok: true;
  source: {
    kind: "capture" | "artifact";
    id: string;
    path: string;
  };
  preset: TargetNetworkQueryPreset;
  returned: number;
  rows: Array<Record<string, string | number | boolean | null>>;
  summary: {
    requests: number;
    failed: number;
    webSockets: number;
    bytesApproxTotal: number;
    p95LatencyMs: number | null;
  };
};

export type TargetNetworkTailReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  actionId: string | null;
  captureMs: number;
  eventCount: number;
  counts: {
    requests: number;
    responses: number;
    failures: number;
    webSockets: number;
    wsMessages: number;
  };
};

export type TargetNetworkCheckBudget = {
  maxP95LatencyMs?: number;
  maxErrorRate?: number;
  maxBytesApproxTotal?: number;
  maxWsMessages?: number;
  maxRequests?: number;
};

export type TargetNetworkCheckReport = {
  ok: true;
  passed: boolean;
  source: {
    kind: "capture-live" | "capture-saved" | "artifact";
    id: string;
  };
  metrics: {
    requests: number;
    failures: number;
    errorRate: number;
    p95LatencyMs: number | null;
    bytesApproxTotal: number;
    wsMessages: number;
  };
  checks: Array<{
    name: string;
    limit: number;
    actual: number;
    passed: boolean;
  }>;
  budget: TargetNetworkCheckBudget;
};
