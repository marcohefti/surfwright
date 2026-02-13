export const DEFAULT_SESSION_ID = "s-default";
export const DEFAULT_OPEN_TIMEOUT_MS = 20000;
export const DEFAULT_SESSION_TIMEOUT_MS = 12000;
export const DEFAULT_TARGET_TIMEOUT_MS = 10000;
export const DEFAULT_TARGET_FIND_LIMIT = 12;
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

export type TargetFindReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  mode: "text" | "selector";
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
