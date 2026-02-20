export const DEFAULT_SESSION_ID = "s-default";
export const DEFAULT_OPEN_TIMEOUT_MS = 20000;
export const DEFAULT_SESSION_TIMEOUT_MS = 12000;
export const DEFAULT_SESSION_LEASE_TTL_MS = 72 * 60 * 60 * 1000;
export const MIN_SESSION_LEASE_TTL_MS = 60 * 1000;
export const MAX_SESSION_LEASE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_EPHEMERAL_SESSION_LEASE_TTL_MS = 4 * 60 * 60 * 1000;
export const DEFAULT_IMPLICIT_SESSION_LEASE_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_TARGET_TIMEOUT_MS = 10000;
export const DEFAULT_TARGET_FIND_LIMIT = 12;
export const DEFAULT_TARGET_READ_CHUNK_SIZE = 1200;
export const DEFAULT_TARGET_EVAL_MAX_CONSOLE = 20;
export const DEFAULT_TARGET_NETWORK_CAPTURE_MS = 2500;
export const DEFAULT_TARGET_NETWORK_MAX_REQUESTS = 120;
export const DEFAULT_TARGET_NETWORK_MAX_WEBSOCKETS = 24;
export const DEFAULT_TARGET_NETWORK_MAX_WS_MESSAGES = 120;
export const DEFAULT_TARGET_NETWORK_MAX_RUNTIME_MS = 600000;
export const STATE_VERSION = 4;
export type ActionTimingMs = {
  total: number;
  resolveSession: number;
  connectCdp: number;
  action: number;
  persistState: number;
};
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
export type SessionPolicy = "ephemeral" | "persistent";
export type SessionSource = "explicit" | "target-inferred" | "implicit-new";
export type BrowserMode = "headless" | "headed" | "unknown";
export type ManagedBrowserMode = Exclude<BrowserMode, "unknown">;

export type WorkspaceInfoReport = {
  ok: true;
  found: boolean;
  workspaceDir: string | null;
  profilesDir: string | null;
  profileSessionsDir: string | null;
  hint: string | null;
};

export type WorkspaceInitReport = {
  ok: true;
  workspaceDir: string;
  markerPath: string;
  profilesDir: string;
  profileSessionsDir: string;
  gitignore: { path: string; updated: boolean };
};

export type WorkspaceProfileLocksReport = {
  ok: true;
  found: boolean;
  workspaceDir: string | null;
  profileSessionsDir: string | null;
  locks: Array<{
    profile: string;
    path: string;
    pid: number | null;
    ageMs: number | null;
    pidAlive: boolean | null;
    stale: boolean;
  }>;
  hint: string | null;
};

export type WorkspaceProfileLockClearReport = {
  ok: true;
  found: boolean;
  profile: string;
  cleared: boolean;
  path: string | null;
  reason: "not_found" | "active" | "cleared" | "forced";
  hint: string | null;
};

export type DownloadCaptureReport = {
  finalUrl: string;
  status: number | null;
  headers: Record<string, string>;
  filename: string;
  path: string;
  sha256: string;
  size: number;
};
export type OpenReport = {
  ok: true;
  sessionId: string;
  sessionSource: SessionSource;
  browserMode: BrowserMode;
  profile: string | null;
  targetId: string;
  actionId: string;
  requestedUrl: string;
  finalUrl: string;
  wasRedirected: boolean;
  redirectChain: string[] | null;
  redirectChainTruncated: boolean;
  url: string;
  status: number | null;
  title: string;
  download: DownloadCaptureReport | null;
  waitUntil: "commit" | "domcontentloaded" | "load" | "networkidle";
  reuseMode: "off" | "url" | "origin" | "active";
  reusedTarget: boolean;
  timingMs: ActionTimingMs;
};
export type SessionReport = {
  ok: true;
  sessionId: string;
  kind: SessionKind;
  cdpOrigin: string;
  browserMode: BrowserMode;
  profile: string | null;
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
    browserMode: BrowserMode;
    profile: string | null;
    lastSeenAt: string;
  }>;
};
export type SessionCookieCopyReport = {
  ok: true;
  fromSessionId: string;
  toSessionId: string;
  urls: string[];
  counts: { found: number; imported: number; uniqueDomains: number };
  sample: { cookieNames: string[]; domains: string[]; truncated: boolean };
  timingMs: ActionTimingMs;
};
export type SessionPruneReport = {
  ok: true;
  activeSessionId: string | null;
  scanned: number;
  kept: number;
  removed: number;
  removedByLeaseExpired: number;
  removedAttachedUnreachable: number;
  removedManagedUnreachable: number;
  removedManagedByGrace: number;
  removedManagedByFlag: number;
  repairedManagedPid: number;
};
export type {
  TargetCountReport,
  TargetClickDeltaEvidence,
  TargetClickDeltaRole,
  TargetClickExplainReport,
  TargetClickReport,
  TargetDownloadReport,
  TargetConsoleTailReport,
  TargetEvalReport,
  TargetExtractReport,
  TargetFindReport,
  TargetFramesReport,
  TargetHealthReport,
  TargetHudReport,
  TargetListReport,
  TargetPruneReport,
  TargetReadReport,
  TargetSnapshotDiffReport,
  TargetSnapshotMode,
  TargetSnapshotReport,
  TargetUrlAssertReport,
  TargetWaitReport,
} from "./types/target.js";
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
  TargetTraceExportReport,
  TargetTraceInsightReport,
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
    removedByLeaseExpired: number;
    removedAttachedUnreachable: number;
    removedManagedUnreachable: number;
    removedManagedByGrace: number;
    removedManagedByFlag: number;
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
  hints?: string[];
  hintContext?: Record<string, string | number | boolean | null>;
};
export type { SessionState, TargetState, SurfwrightState } from "./types/state.js";
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
  contractSchemaVersion: number;
  contractFingerprint: string;
  guarantees: string[];
  commands: CliCommandContract[];
  errors: CliErrorContract[];
  guidance?: Array<{
    id: string;
    signature: string;
    examples: string[];
    proofSchema?: Record<string, unknown> | null;
  }>;
};
