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
export const DEFAULT_TARGET_NETWORK_MAX_RUNTIME_MS = 600000;
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
  actionId: string;
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
export type {
  TargetNetworkArtifactListReport,
  TargetNetworkArtifactPruneReport,
  TargetNetworkCaptureBeginReport,
  TargetNetworkCaptureEndReport,
  TargetNetworkCaptureStatus,
  TargetNetworkCheckBudget,
  TargetNetworkCheckReport,
  TargetNetworkExportReport,
  TargetNetworkHarReport,
  TargetNetworkQueryPreset,
  TargetNetworkQueryReport,
  TargetNetworkReport,
  TargetNetworkRequestReport,
  TargetNetworkTailReport,
  TargetNetworkWebSocketMessageReport,
  TargetNetworkWebSocketReport,
} from "./network-types.js";

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
  lastActionId?: string | null;
  lastActionAt?: string | null;
  lastActionKind?: string | null;
  updatedAt: string;
};

export type SurfwrightState = {
  version: number;
  activeSessionId: string | null;
  nextSessionOrdinal: number;
  nextCaptureOrdinal: number;
  nextArtifactOrdinal: number;
  sessions: Record<string, SessionState>;
  targets: Record<string, TargetState>;
  networkCaptures: Record<
    string,
    {
      captureId: string;
      sessionId: string;
      targetId: string;
      startedAt: string;
      status: TargetNetworkCaptureStatus;
      profile: "custom" | "api" | "page" | "ws" | "perf";
      maxRuntimeMs: number;
      workerPid: number | null;
      stopSignalPath: string;
      donePath: string;
      resultPath: string;
      endedAt: string | null;
      actionId: string;
    }
  >;
  networkArtifacts: Record<
    string,
    {
      artifactId: string;
      createdAt: string;
      format: "har";
      path: string;
      sessionId: string;
      targetId: string;
      captureId: string | null;
      entries: number;
      bytes: number;
    }
  >;
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
import type { TargetNetworkCaptureStatus } from "./network-types.js";
