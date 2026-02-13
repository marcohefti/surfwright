import { CliError } from "../../errors.js";
import {
  DEFAULT_TARGET_NETWORK_CAPTURE_MS,
  DEFAULT_TARGET_NETWORK_MAX_REQUESTS,
  DEFAULT_TARGET_NETWORK_MAX_WEBSOCKETS,
  DEFAULT_TARGET_NETWORK_MAX_WS_MESSAGES,
} from "../../types.js";
import type { TargetNetworkRequestReport } from "../../types.js";

const NETWORK_CAPTURE_MIN_MS = 50;
const NETWORK_CAPTURE_MAX_MS = 120000;
const NETWORK_MAX_REQUESTS_CAP = 1000;
const NETWORK_MAX_WEBSOCKETS_CAP = 200;
const NETWORK_MAX_WS_MESSAGES_CAP = 2000;
const NETWORK_POST_DATA_PREVIEW_MAX_BYTES = 512;
const NETWORK_WS_PREVIEW_MAX_CHARS = 220;

type StatusFilter = {
  kind: "exact" | "class";
  value: number;
};

export type ParsedNetworkInput = {
  profile: "custom" | "api" | "page" | "ws" | "perf";
  view: "raw" | "summary" | "table";
  fields: string[];
  captureMs: number;
  maxRequests: number;
  maxWebSockets: number;
  maxWsMessages: number;
  reload: boolean;
  includeHeaders: boolean;
  includePostData: boolean;
  includeWsMessages: boolean;
  urlContains: string | null;
  method: string | null;
  resourceType: string | null;
  statusInput: string | null;
  statusFilter: StatusFilter | null;
  failedOnly: boolean;
};

type NetworkProfileDefaults = {
  captureMs: number;
  maxRequests: number;
  maxWebSockets: number;
  maxWsMessages: number;
  includeHeaders: boolean;
  includePostData: boolean;
  includeWsMessages: boolean;
  reload: boolean;
};

const PROFILE_DEFAULTS: Record<ParsedNetworkInput["profile"], NetworkProfileDefaults> = {
  custom: {
    captureMs: DEFAULT_TARGET_NETWORK_CAPTURE_MS,
    maxRequests: DEFAULT_TARGET_NETWORK_MAX_REQUESTS,
    maxWebSockets: DEFAULT_TARGET_NETWORK_MAX_WEBSOCKETS,
    maxWsMessages: DEFAULT_TARGET_NETWORK_MAX_WS_MESSAGES,
    includeHeaders: false,
    includePostData: false,
    includeWsMessages: true,
    reload: false,
  },
  api: {
    captureMs: 3000,
    maxRequests: 240,
    maxWebSockets: 16,
    maxWsMessages: 80,
    includeHeaders: true,
    includePostData: true,
    includeWsMessages: false,
    reload: false,
  },
  page: {
    captureMs: 3200,
    maxRequests: 220,
    maxWebSockets: 24,
    maxWsMessages: 120,
    includeHeaders: false,
    includePostData: false,
    includeWsMessages: true,
    reload: true,
  },
  ws: {
    captureMs: 4500,
    maxRequests: 140,
    maxWebSockets: 80,
    maxWsMessages: 600,
    includeHeaders: false,
    includePostData: false,
    includeWsMessages: true,
    reload: false,
  },
  perf: {
    captureMs: 5000,
    maxRequests: 320,
    maxWebSockets: 24,
    maxWsMessages: 120,
    includeHeaders: false,
    includePostData: false,
    includeWsMessages: false,
    reload: true,
  },
};

function parseProfile(input: string | undefined): ParsedNetworkInput["profile"] {
  if (typeof input !== "string" || input.trim().length === 0) {
    return "custom";
  }
  const value = input.trim().toLowerCase();
  if (value === "api" || value === "page" || value === "ws" || value === "perf" || value === "custom") {
    return value;
  }
  throw new CliError("E_QUERY_INVALID", "profile must be one of: custom, api, page, ws, perf");
}

function parseView(input: string | undefined): ParsedNetworkInput["view"] {
  if (typeof input !== "string" || input.trim().length === 0) {
    return "raw";
  }
  const value = input.trim().toLowerCase();
  if (value === "raw" || value === "summary" || value === "table") {
    return value;
  }
  throw new CliError("E_QUERY_INVALID", "view must be one of: raw, summary, table");
}

function parseFields(input: string | undefined): string[] {
  if (typeof input !== "string" || input.trim().length === 0) {
    return ["id", "method", "status", "durationMs", "resourceType", "url"];
  }
  const fields = input
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (fields.length === 0) {
    throw new CliError("E_QUERY_INVALID", "fields must not be empty");
  }
  return fields.slice(0, 16);
}

function parsePositiveInt(opts: {
  value: number | undefined;
  defaultValue: number;
  min: number;
  max: number;
  name: string;
}): number {
  if (typeof opts.value === "undefined") {
    return opts.defaultValue;
  }
  if (!Number.isFinite(opts.value) || !Number.isInteger(opts.value) || opts.value < opts.min || opts.value > opts.max) {
    throw new CliError("E_QUERY_INVALID", `${opts.name} must be an integer between ${opts.min} and ${opts.max}`);
  }
  return opts.value;
}

function parseNonEmpty(input: string | undefined, name: string): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const value = input.trim();
  if (!value) {
    throw new CliError("E_QUERY_INVALID", `${name} must not be empty`);
  }
  return value;
}

function parseMethod(input: string | undefined): string | null {
  const value = parseNonEmpty(input, "method");
  if (value === null) {
    return null;
  }
  const normalized = value.toUpperCase();
  if (!/^[A-Z-]+$/.test(normalized)) {
    throw new CliError("E_QUERY_INVALID", "method must only contain letters and hyphen");
  }
  return normalized;
}

function parseResourceType(input: string | undefined): string | null {
  const value = parseNonEmpty(input, "resource-type");
  if (value === null) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (!/^[a-z-]+$/.test(normalized)) {
    throw new CliError("E_QUERY_INVALID", "resource-type must only contain lowercase letters and hyphen");
  }
  return normalized;
}

function parseStatusFilter(input: string | undefined): {
  statusInput: string | null;
  statusFilter: StatusFilter | null;
} {
  const value = parseNonEmpty(input, "status");
  if (value === null) {
    return {
      statusInput: null,
      statusFilter: null,
    };
  }

  const normalized = value.toLowerCase();
  if (/^[1-5]xx$/.test(normalized)) {
    return {
      statusInput: normalized,
      statusFilter: {
        kind: "class",
        value: Number.parseInt(normalized[0] ?? "0", 10),
      },
    };
  }

  if (/^\d{3}$/.test(normalized)) {
    const parsed = Number.parseInt(normalized, 10);
    if (parsed < 100 || parsed > 599) {
      throw new CliError("E_QUERY_INVALID", "status must be a 3-digit HTTP status or class like 2xx");
    }
    return {
      statusInput: normalized,
      statusFilter: {
        kind: "exact",
        value: parsed,
      },
    };
  }

  throw new CliError("E_QUERY_INVALID", "status must be a 3-digit HTTP status or class like 2xx");
}

export function parseNetworkInput(opts: {
  profile?: string;
  view?: string;
  fields?: string;
  captureMs?: number;
  maxRequests?: number;
  maxWebSockets?: number;
  maxWsMessages?: number;
  reload?: boolean;
  includeHeaders?: boolean;
  includePostData?: boolean;
  includeWsMessages?: boolean;
  urlContains?: string;
  method?: string;
  resourceType?: string;
  status?: string;
  failedOnly?: boolean;
}): ParsedNetworkInput {
  const profile = parseProfile(opts.profile);
  const profileDefaults = PROFILE_DEFAULTS[profile];
  const fields = parseFields(opts.fields);
  const status = parseStatusFilter(opts.status);
  return {
    profile,
    view: parseView(opts.view),
    fields,
    captureMs: parsePositiveInt({
      value: opts.captureMs,
      defaultValue: profileDefaults.captureMs,
      min: NETWORK_CAPTURE_MIN_MS,
      max: NETWORK_CAPTURE_MAX_MS,
      name: "capture-ms",
    }),
    maxRequests: parsePositiveInt({
      value: opts.maxRequests,
      defaultValue: profileDefaults.maxRequests,
      min: 1,
      max: NETWORK_MAX_REQUESTS_CAP,
      name: "max-requests",
    }),
    maxWebSockets: parsePositiveInt({
      value: opts.maxWebSockets,
      defaultValue: profileDefaults.maxWebSockets,
      min: 1,
      max: NETWORK_MAX_WEBSOCKETS_CAP,
      name: "max-websockets",
    }),
    maxWsMessages: parsePositiveInt({
      value: opts.maxWsMessages,
      defaultValue: profileDefaults.maxWsMessages,
      min: 1,
      max: NETWORK_MAX_WS_MESSAGES_CAP,
      name: "max-ws-messages",
    }),
    reload: typeof opts.reload === "boolean" ? opts.reload : profileDefaults.reload,
    includeHeaders: typeof opts.includeHeaders === "boolean" ? opts.includeHeaders : profileDefaults.includeHeaders,
    includePostData: typeof opts.includePostData === "boolean" ? opts.includePostData : profileDefaults.includePostData,
    includeWsMessages:
      typeof opts.includeWsMessages === "boolean" ? opts.includeWsMessages : profileDefaults.includeWsMessages,
    urlContains: parseNonEmpty(opts.urlContains, "url-contains"),
    method: parseMethod(opts.method),
    resourceType: parseResourceType(opts.resourceType),
    statusInput: status.statusInput,
    statusFilter: status.statusFilter,
    failedOnly: Boolean(opts.failedOnly),
  };
}

export function toRelativeMs(startEpochMs: number): number {
  return Math.max(0, Date.now() - startEpochMs);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function maybeTruncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function postDataPreview(buffer: Buffer): string {
  const sliced = buffer.subarray(0, NETWORK_POST_DATA_PREVIEW_MAX_BYTES);
  const utf8Text = sliced.toString("utf8");
  const printable = /^[\x09\x0A\x0D\x20-\x7E]*$/.test(utf8Text);
  if (printable) {
    const text = normalizeWhitespace(utf8Text);
    return maybeTruncate(text, NETWORK_POST_DATA_PREVIEW_MAX_BYTES);
  }
  return `base64:${sliced.toString("base64")}`;
}

export function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function matchesStatusFilter(status: number | null, filter: StatusFilter | null): boolean {
  if (filter === null) {
    return true;
  }
  if (status === null) {
    return false;
  }
  if (filter.kind === "exact") {
    return status === filter.value;
  }
  return Math.floor(status / 100) === filter.value;
}

export function matchesRequestFilters(request: TargetNetworkRequestReport, parsed: ParsedNetworkInput): boolean {
  if (parsed.urlContains && !request.url.includes(parsed.urlContains)) {
    return false;
  }
  if (parsed.method && request.method !== parsed.method) {
    return false;
  }
  if (parsed.resourceType && request.resourceType !== parsed.resourceType) {
    return false;
  }
  if (!matchesStatusFilter(request.status, parsed.statusFilter)) {
    return false;
  }
  if (parsed.failedOnly && request.failure === null) {
    return false;
  }
  return true;
}

export function wsFramePreview(payload: unknown): { preview: string; sizeBytes: number } {
  const asString = typeof payload === "string" ? payload : "";
  const sizeBytes = Buffer.byteLength(asString, "utf8");
  const preview = maybeTruncate(asString, NETWORK_WS_PREVIEW_MAX_CHARS);
  return {
    preview,
    sizeBytes,
  };
}

export function pushBackgroundTask(backgroundTasks: Promise<void>[], task: () => Promise<void>): void {
  backgroundTasks.push(
    task().catch(() => {
      // Network diagnostics should be best-effort and never fail the main flow on enrichment errors.
    }),
  );
}
