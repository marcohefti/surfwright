import { CliError } from "./errors.js";
import { resolveNetworkReportSource } from "./target-network-source.js";
import { matchesRequestFilters, parseNetworkInput } from "./target-network-utils.js";
import type { TargetNetworkQueryPreset, TargetNetworkQueryReport } from "./types.js";

const QUERY_ROW_CAP = 500;

function parsePreset(input: string | undefined): TargetNetworkQueryPreset {
  if (typeof input === "undefined" || input.trim().length === 0) {
    return "summary";
  }
  const value = input.trim().toLowerCase();
  if (value === "summary" || value === "slowest" || value === "errors" || value === "largest" || value === "ws-hotspots") {
    return value;
  }
  throw new CliError("E_QUERY_INVALID", "preset must be one of: summary, slowest, errors, largest, ws-hotspots");
}

function parseLimit(input: number | undefined): number {
  if (typeof input === "undefined") {
    return 20;
  }
  if (!Number.isFinite(input) || !Number.isInteger(input) || input < 1 || input > QUERY_ROW_CAP) {
    throw new CliError("E_QUERY_INVALID", `limit must be an integer between 1 and ${QUERY_ROW_CAP}`);
  }
  return input;
}

export function targetNetworkQuery(opts: {
  captureId?: string;
  artifactId?: string;
  preset?: string;
  profile?: string;
  limit?: number;
  urlContains?: string;
  method?: string;
  resourceType?: string;
  status?: string;
  failedOnly?: boolean;
}): TargetNetworkQueryReport {
  const source = resolveNetworkReportSource({
    captureId: opts.captureId,
    artifactId: opts.artifactId,
  });
  const preset = parsePreset(opts.preset);
  const limit = parseLimit(opts.limit);
  const parsed = parseNetworkInput({
    profile: opts.profile ?? source.report.filters.profile,
    view: "raw",
    captureMs: source.report.capture.captureMs,
    maxRequests: source.report.limits.maxRequests,
    maxWebSockets: source.report.limits.maxWebSockets,
    maxWsMessages: source.report.limits.maxWsMessages,
    urlContains: opts.urlContains,
    method: opts.method,
    resourceType: opts.resourceType,
    status: opts.status,
    failedOnly: opts.failedOnly,
  });
  const urlContains = parsed.urlContains;
  const filteredRequests = source.report.requests.filter((request) => matchesRequestFilters(request, parsed));
  const filteredSockets =
    urlContains === null
      ? source.report.webSockets
      : source.report.webSockets.filter((socket) => socket.url.includes(urlContains));
  const summary = {
    requests: filteredRequests.length,
    failed: filteredRequests.filter((request) => request.failure !== null).length,
    webSockets: filteredSockets.length,
    bytesApproxTotal: filteredRequests.reduce((acc, request) => acc + (request.bytesApprox ?? 0), 0),
    p95LatencyMs: source.report.performance.latencyMs.p95,
  };

  let rows: Array<Record<string, string | number | boolean | null>> = [];
  if (preset === "summary") {
    rows = [
      {
        requests: summary.requests,
        failed: summary.failed,
        webSockets: summary.webSockets,
        bytesApproxTotal: summary.bytesApproxTotal,
        p95LatencyMs: summary.p95LatencyMs,
      },
    ];
  } else if (preset === "slowest") {
    rows = [...filteredRequests]
      .filter((request) => typeof request.durationMs === "number")
      .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
      .slice(0, limit)
      .map((request) => ({
        id: request.id,
        actionId: request.actionId,
        method: request.method,
        status: request.status,
        durationMs: request.durationMs,
        ttfbMs: request.ttfbMs,
        bytesApprox: request.bytesApprox,
        url: request.url,
      }));
  } else if (preset === "errors") {
    rows = filteredRequests
      .filter((request) => request.failure !== null || (request.status !== null && request.status >= 400))
      .slice(0, limit)
      .map((request) => ({
        id: request.id,
        actionId: request.actionId,
        method: request.method,
        status: request.status,
        failure: request.failure,
        resourceType: request.resourceType,
        url: request.url,
      }));
  } else if (preset === "largest") {
    rows = [...filteredRequests]
      .sort((a, b) => (b.bytesApprox ?? 0) - (a.bytesApprox ?? 0))
      .slice(0, limit)
      .map((request) => ({
        id: request.id,
        actionId: request.actionId,
        method: request.method,
        status: request.status,
        bytesApprox: request.bytesApprox ?? 0,
        durationMs: request.durationMs,
        url: request.url,
      }));
  } else {
    rows = [...filteredSockets]
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, limit)
      .map((socket) => ({
        id: socket.id,
        actionId: socket.actionId,
        url: socket.url,
        messages: socket.messageCount,
        durationMs: socket.durationMs,
        closed: socket.closed,
        error: socket.error,
      }));
  }

  return {
    ok: true,
    source: source.source,
    preset,
    returned: rows.length,
    rows,
    summary,
  };
}
