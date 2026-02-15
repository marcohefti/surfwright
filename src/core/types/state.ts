import type { TargetNetworkCaptureStatus } from "../network-types.js";
import type { BrowserMode, SessionKind, SessionPolicy } from "../types.js";

export type SessionState = {
  sessionId: string;
  kind: SessionKind;
  policy: SessionPolicy;
  browserMode: BrowserMode;
  cdpOrigin: string;
  debugPort: number | null;
  userDataDir: string | null;
  browserPid: number | null;
  ownerId: string | null;
  leaseExpiresAt: string | null;
  leaseTtlMs: number | null;
  managedUnreachableSince: string | null;
  managedUnreachableCount: number;
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

