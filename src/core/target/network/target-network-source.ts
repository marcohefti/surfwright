import { CliError } from "../../errors.js";
import { readState } from "../../state/index.js";
import { buildInsights, buildPerformanceSummary, buildTruncationHints } from "./target-network-analysis.js";
import type { TargetNetworkReport, TargetNetworkRequestReport } from "../../types.js";
import { providers } from "../../providers/index.js";

const CAPTURE_ID_PATTERN = /^c-[0-9]+$/;
const ARTIFACT_ID_PATTERN = /^na-[0-9]+$/;

function parseCaptureId(input: string): string {
  const value = input.trim();
  if (!CAPTURE_ID_PATTERN.test(value)) {
    throw new CliError("E_QUERY_INVALID", "capture-id is invalid");
  }
  return value;
}

function parseArtifactId(input: string): string {
  const value = input.trim();
  if (!ARTIFACT_ID_PATTERN.test(value)) {
    throw new CliError("E_QUERY_INVALID", "artifact-id is invalid");
  }
  return value;
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(providers().fs.readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new CliError("E_QUERY_INVALID", `Failed to read JSON source: ${path}`);
  }
}

function headersArrayToMap(raw: unknown): Record<string, string> {
  if (!Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const entry = item as { name?: unknown; value?: unknown };
    if (typeof entry.name !== "string" || typeof entry.value !== "string") {
      continue;
    }
    out[entry.name] = entry.value;
  }
  return out;
}

function toRequestFromHar(entry: unknown, index: number, captureStartMs: number): TargetNetworkRequestReport {
  const value = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
  const startedDateTimeRaw = typeof value.startedDateTime === "string" ? value.startedDateTime : "";
  const startedDateTimeMs = Date.parse(startedDateTimeRaw);
  const startMs = Number.isFinite(startedDateTimeMs) ? Math.max(0, startedDateTimeMs - captureStartMs) : 0;
  const durationRaw = value.time;
  const durationMs =
    typeof durationRaw === "number" && Number.isFinite(durationRaw) && durationRaw >= 0 ? durationRaw : null;
  const requestRaw = typeof value.request === "object" && value.request !== null ? (value.request as Record<string, unknown>) : {};
  const responseRaw =
    typeof value.response === "object" && value.response !== null ? (value.response as Record<string, unknown>) : {};
  const timingsRaw = typeof value.timings === "object" && value.timings !== null ? (value.timings as Record<string, unknown>) : {};
  const surfRaw =
    typeof value._surfwright === "object" && value._surfwright !== null ? (value._surfwright as Record<string, unknown>) : {};
  const statusRaw = responseRaw.status;
  const status = typeof statusRaw === "number" && Number.isFinite(statusRaw) && statusRaw > 0 ? statusRaw : null;
  const method = typeof requestRaw.method === "string" ? requestRaw.method.toUpperCase() : "GET";
  const url = typeof requestRaw.url === "string" ? requestRaw.url : "";
  const failure =
    typeof surfRaw.failure === "string" && surfRaw.failure.trim().length > 0
      ? surfRaw.failure.trim()
      : typeof responseRaw.statusText === "string" && responseRaw.statusText.trim().length > 0 && status === null
        ? responseRaw.statusText.trim()
        : null;
  const bytesApproxRaw =
    typeof responseRaw.bodySize === "number" && Number.isFinite(responseRaw.bodySize) && responseRaw.bodySize >= 0
      ? responseRaw.bodySize
      : null;
  const requestHeaders = headersArrayToMap(requestRaw.headers);
  const responseHeaders = headersArrayToMap(responseRaw.headers);
  return {
    id: index,
    captureKey: `har:req:${index}`,
    actionId: null,
    redirectedFromId: null,
    url,
    method,
    resourceType: typeof surfRaw.resourceType === "string" ? surfRaw.resourceType : "other",
    navigation: Boolean(surfRaw.navigation),
    startMs,
    endMs: durationMs === null ? null : startMs + durationMs,
    durationMs,
    ttfbMs:
      typeof surfRaw.ttfbMs === "number" && Number.isFinite(surfRaw.ttfbMs)
        ? surfRaw.ttfbMs
        : typeof timingsRaw.wait === "number" && Number.isFinite(timingsRaw.wait)
          ? timingsRaw.wait
          : null,
    status,
    ok: typeof surfRaw.ok === "boolean" ? surfRaw.ok : status === null ? null : status >= 200 && status < 400,
    failure,
    bytesApprox: bytesApproxRaw,
    requestHeaders: Object.keys(requestHeaders).length > 0 ? requestHeaders : undefined,
    responseHeaders: Object.keys(responseHeaders).length > 0 ? responseHeaders : undefined,
    postDataPreview: null,
  };
}

function buildReportFromHarSource(opts: {
  sourceId: string;
  path: string;
  sessionId: string;
  targetId: string;
  captureId: string | null;
}): TargetNetworkReport {
  const raw = readJsonFile(opts.path) as {
    log?: {
      pages?: Array<{ startedDateTime?: unknown; title?: unknown; _surfwright?: { url?: unknown } }>;
      entries?: unknown[];
    };
  };
  const entries = Array.isArray(raw?.log?.entries) ? raw.log.entries : [];
  const firstPage = Array.isArray(raw?.log?.pages) ? raw.log.pages[0] : undefined;
  const captureStartedAt =
    typeof firstPage?.startedDateTime === "string" && firstPage.startedDateTime.length > 0
      ? firstPage.startedDateTime
      : new Date().toISOString();
  const captureStartMs = Date.parse(captureStartedAt);
  const requests = entries.map((entry, index) => toRequestFromHar(entry, index + 1, Number.isFinite(captureStartMs) ? captureStartMs : Date.now()));
  const durationMs = requests.reduce((acc, req) => {
    const endMs = req.endMs ?? req.startMs;
    return Math.max(acc, endMs);
  }, 0);
  const counts = {
    requestsSeen: requests.length,
    requestsReturned: requests.length,
    responsesSeen: requests.filter((request) => request.status !== null).length,
    failedSeen: requests.filter((request) => request.failure !== null).length,
    webSocketsSeen: 0,
    webSocketsReturned: 0,
    wsMessagesSeen: 0,
    wsMessagesReturned: 0,
    droppedRequests: 0,
    droppedWebSockets: 0,
    droppedWsMessages: 0,
  };
  return {
    ok: true,
    sessionId: opts.sessionId,
    sessionSource: "explicit",
    targetId: opts.targetId,
    captureId: opts.captureId,
    actionId: null,
    url:
      typeof firstPage?._surfwright?.url === "string"
        ? firstPage._surfwright.url
        : requests[0]?.url ?? "",
    title: typeof firstPage?.title === "string" ? firstPage.title : `HAR ${opts.sourceId}`,
    capture: {
      startedAt: captureStartedAt,
      endedAt: new Date((Number.isFinite(captureStartMs) ? captureStartMs : Date.now()) + durationMs).toISOString(),
      durationMs,
      captureMs: durationMs,
      reload: false,
    },
    filters: {
      urlContains: null,
      method: null,
      resourceType: null,
      status: null,
      failedOnly: false,
      profile: "custom",
    },
    view: "raw",
    fields: ["id", "method", "status", "durationMs", "resourceType", "url"],
    tableRows: [],
    limits: {
      maxRequests: Math.max(1, requests.length),
      maxWebSockets: 1,
      maxWsMessages: 1,
    },
    counts,
    performance: buildPerformanceSummary(requests),
    truncated: {
      requests: false,
      webSockets: false,
      wsMessages: false,
    },
    hints: buildTruncationHints({
      droppedRequests: 0,
      droppedWebSockets: 0,
      droppedWsMessages: 0,
      maxRequests: Math.max(1, requests.length),
      maxWebSockets: 1,
      maxWsMessages: 1,
    }),
    insights: buildInsights(requests, []),
    requests,
    webSockets: [],
  };
}

function parseReportFromCapture(path: string): TargetNetworkReport {
  const raw = readJsonFile(path) as TargetNetworkReport & { sessionSource?: unknown };
  if (!raw || raw.ok !== true || !Array.isArray(raw.requests) || !Array.isArray(raw.webSockets)) {
    throw new CliError("E_QUERY_INVALID", `Capture result is invalid: ${path}`);
  }
  return {
    ...raw,
    sessionSource:
      raw.sessionSource === "explicit" || raw.sessionSource === "target-inferred" || raw.sessionSource === "implicit-new"
        ? raw.sessionSource
        : "explicit",
  };
}

export function resolveNetworkReportSource(opts: {
  captureId?: string;
  artifactId?: string;
}): {
  source: {
    kind: "capture" | "artifact";
    id: string;
    path: string;
  };
  report: TargetNetworkReport;
} {
  const state = readState();
  if (opts.captureId && opts.artifactId) {
    throw new CliError("E_QUERY_INVALID", "Provide only one source selector: capture-id or artifact-id");
  }
  if (opts.captureId) {
    const captureId = parseCaptureId(opts.captureId);
    const capture = state.networkCaptures[captureId];
    if (!capture) {
      throw new CliError("E_QUERY_INVALID", `Capture ${captureId} not found`);
    }
    return {
      source: {
        kind: "capture",
        id: captureId,
        path: capture.resultPath,
      },
      report: parseReportFromCapture(capture.resultPath),
    };
  }
  if (opts.artifactId) {
    const artifactId = parseArtifactId(opts.artifactId);
    const artifact = state.networkArtifacts[artifactId];
    if (!artifact) {
      throw new CliError("E_QUERY_INVALID", `Artifact ${artifactId} not found`);
    }
    return {
      source: {
        kind: "artifact",
        id: artifactId,
        path: artifact.path,
      },
      report: buildReportFromHarSource({
        sourceId: artifactId,
        path: artifact.path,
        sessionId: artifact.sessionId,
        targetId: artifact.targetId,
        captureId: artifact.captureId,
      }),
    };
  }

  const captures = Object.values(state.networkCaptures)
    .filter((capture) => providers().fs.existsSync(capture.resultPath))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (captures.length > 0) {
    const capture = captures[0];
    return {
      source: {
        kind: "capture",
        id: capture.captureId,
        path: capture.resultPath,
      },
      report: parseReportFromCapture(capture.resultPath),
    };
  }

  const artifacts = Object.values(state.networkArtifacts)
    .filter((artifact) => providers().fs.existsSync(artifact.path))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (artifacts.length > 0) {
    const artifact = artifacts[0];
    return {
      source: {
        kind: "artifact",
        id: artifact.artifactId,
        path: artifact.path,
      },
      report: buildReportFromHarSource({
        sourceId: artifact.artifactId,
        path: artifact.path,
        sessionId: artifact.sessionId,
        targetId: artifact.targetId,
        captureId: artifact.captureId,
      }),
    };
  }

  throw new CliError("E_QUERY_INVALID", "No capture/artifact source found");
}
