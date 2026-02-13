import { CliError } from "./errors.js";
import {
  DEFAULT_TARGET_NETWORK_CAPTURE_MS,
  DEFAULT_TARGET_NETWORK_MAX_REQUESTS,
  DEFAULT_TARGET_NETWORK_MAX_WEBSOCKETS,
  DEFAULT_TARGET_NETWORK_MAX_WS_MESSAGES,
} from "./types.js";
import type { TargetNetworkReport, TargetNetworkRequestReport } from "./types.js";

const NETWORK_CAPTURE_MIN_MS = 50;
const NETWORK_CAPTURE_MAX_MS = 120000;
const NETWORK_MAX_REQUESTS_CAP = 1000;
const NETWORK_MAX_WEBSOCKETS_CAP = 200;
const NETWORK_MAX_WS_MESSAGES_CAP = 2000;
const NETWORK_POST_DATA_PREVIEW_MAX_BYTES = 512;
const NETWORK_WS_PREVIEW_MAX_CHARS = 220;
const NETWORK_TOP_SLOWEST_LIMIT = 5;

type StatusFilter = {
  kind: "exact" | "class";
  value: number;
};

export type ParsedNetworkInput = {
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
  const status = parseStatusFilter(opts.status);
  return {
    captureMs: parsePositiveInt({
      value: opts.captureMs,
      defaultValue: DEFAULT_TARGET_NETWORK_CAPTURE_MS,
      min: NETWORK_CAPTURE_MIN_MS,
      max: NETWORK_CAPTURE_MAX_MS,
      name: "capture-ms",
    }),
    maxRequests: parsePositiveInt({
      value: opts.maxRequests,
      defaultValue: DEFAULT_TARGET_NETWORK_MAX_REQUESTS,
      min: 1,
      max: NETWORK_MAX_REQUESTS_CAP,
      name: "max-requests",
    }),
    maxWebSockets: parsePositiveInt({
      value: opts.maxWebSockets,
      defaultValue: DEFAULT_TARGET_NETWORK_MAX_WEBSOCKETS,
      min: 1,
      max: NETWORK_MAX_WEBSOCKETS_CAP,
      name: "max-websockets",
    }),
    maxWsMessages: parsePositiveInt({
      value: opts.maxWsMessages,
      defaultValue: DEFAULT_TARGET_NETWORK_MAX_WS_MESSAGES,
      min: 1,
      max: NETWORK_MAX_WS_MESSAGES_CAP,
      name: "max-ws-messages",
    }),
    reload: Boolean(opts.reload),
    includeHeaders: Boolean(opts.includeHeaders),
    includePostData: Boolean(opts.includePostData),
    includeWsMessages: opts.includeWsMessages !== false,
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

function statFromValues(values: number[]): { min: number | null; max: number | null; avg: number | null; p50: number | null; p95: number | null } {
  if (values.length === 0) {
    return {
      min: null,
      max: null,
      avg: null,
      p50: null,
      p95: null,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  const pick = (percentile: number): number => {
    const index = Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1);
    return sorted[index] ?? sorted[sorted.length - 1] ?? 0;
  };

  return {
    min: rounded(sorted[0] ?? 0),
    max: rounded(sorted[sorted.length - 1] ?? 0),
    avg: rounded(sum / sorted.length),
    p50: rounded(pick(50)),
    p95: rounded(pick(95)),
  };
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

function toStatusBuckets(requests: TargetNetworkRequestReport[]): TargetNetworkReport["performance"]["statusBuckets"] {
  const buckets: TargetNetworkReport["performance"]["statusBuckets"] = {
    "2xx": 0,
    "3xx": 0,
    "4xx": 0,
    "5xx": 0,
    other: 0,
  };
  for (const request of requests) {
    const status = request.status;
    if (status === null) {
      continue;
    }
    if (status >= 200 && status < 300) {
      buckets["2xx"] += 1;
      continue;
    }
    if (status >= 300 && status < 400) {
      buckets["3xx"] += 1;
      continue;
    }
    if (status >= 400 && status < 500) {
      buckets["4xx"] += 1;
      continue;
    }
    if (status >= 500 && status < 600) {
      buckets["5xx"] += 1;
      continue;
    }
    buckets.other += 1;
  }
  return buckets;
}

export function buildPerformanceSummary(requests: TargetNetworkRequestReport[]): TargetNetworkReport["performance"] {
  const completed = requests.filter((request) => typeof request.durationMs === "number" && request.durationMs >= 0);
  const durations = completed.map((request) => request.durationMs ?? 0);
  const ttfbValues = requests
    .map((request) => request.ttfbMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const bytesApproxTotal = requests.reduce((acc, request) => acc + (request.bytesApprox ?? 0), 0);
  const slowest = [...completed]
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
    .slice(0, NETWORK_TOP_SLOWEST_LIMIT)
    .map((request) => ({
      id: request.id,
      url: request.url,
      resourceType: request.resourceType,
      status: request.status,
      durationMs: rounded(request.durationMs ?? 0),
    }));

  return {
    completedRequests: completed.length,
    bytesApproxTotal,
    statusBuckets: toStatusBuckets(requests),
    latencyMs: statFromValues(durations),
    ttfbMs: statFromValues(ttfbValues),
    slowest,
  };
}
