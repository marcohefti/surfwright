import type { TargetNetworkReport, TargetNetworkRequestReport } from "../../../types.js";

const NETWORK_MAX_REQUESTS_CAP = 1000;
const NETWORK_MAX_WEBSOCKETS_CAP = 200;
const NETWORK_MAX_WS_MESSAGES_CAP = 2000;
const NETWORK_TOP_SLOWEST_LIMIT = 5;
const NETWORK_TOP_INSIGHT_LIMIT = 5;
const NETWORK_TABLE_ROWS_LIMIT = 200;

function rounded(value: number): number {
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

function hostFromUrl(urlRaw: string): string {
  try {
    return new URL(urlRaw).host;
  } catch {
    return "unknown";
  }
}

export function buildInsights(
  requests: TargetNetworkRequestReport[],
  webSockets: TargetNetworkReport["webSockets"],
): TargetNetworkReport["insights"] {
  const byHost = new Map<string, { requests: number; failures: number; latency: number; latencyCount: number }>();
  const byUrl = new Map<string, { failures: number; status4xx: number; status5xx: number }>();
  for (const request of requests) {
    const host = hostFromUrl(request.url);
    const hostAgg = byHost.get(host) ?? { requests: 0, failures: 0, latency: 0, latencyCount: 0 };
    hostAgg.requests += 1;
    if (request.failure) {
      hostAgg.failures += 1;
    }
    if (typeof request.durationMs === "number") {
      hostAgg.latency += request.durationMs;
      hostAgg.latencyCount += 1;
    }
    byHost.set(host, hostAgg);

    const urlAgg = byUrl.get(request.url) ?? { failures: 0, status4xx: 0, status5xx: 0 };
    if (request.failure) {
      urlAgg.failures += 1;
    }
    if (typeof request.status === "number" && request.status >= 400 && request.status < 500) {
      urlAgg.status4xx += 1;
    }
    if (typeof request.status === "number" && request.status >= 500) {
      urlAgg.status5xx += 1;
    }
    byUrl.set(request.url, urlAgg);
  }

  const topHosts = [...byHost.entries()]
    .sort((a, b) => b[1].requests - a[1].requests)
    .slice(0, NETWORK_TOP_INSIGHT_LIMIT)
    .map(([host, agg]) => ({
      host,
      requests: agg.requests,
      failures: agg.failures,
      avgLatencyMs: agg.latencyCount > 0 ? rounded(agg.latency / agg.latencyCount) : null,
    }));

  const errorHotspots = [...byUrl.entries()]
    .filter(([, agg]) => agg.failures > 0 || agg.status4xx > 0 || agg.status5xx > 0)
    .sort((a, b) => b[1].failures + b[1].status5xx - (a[1].failures + a[1].status5xx))
    .slice(0, NETWORK_TOP_INSIGHT_LIMIT)
    .map(([url, agg]) => ({
      url,
      failures: agg.failures,
      status4xx: agg.status4xx,
      status5xx: agg.status5xx,
    }));

  const websocketHotspots = [...webSockets]
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, NETWORK_TOP_INSIGHT_LIMIT)
    .map((socket) => ({
      url: socket.url,
      messages: socket.messageCount,
      durationMs: socket.durationMs,
    }));

  return {
    topHosts,
    errorHotspots,
    websocketHotspots,
  };
}

export function buildTruncationHints(opts: {
  droppedRequests: number;
  droppedWebSockets: number;
  droppedWsMessages: number;
  maxRequests: number;
  maxWebSockets: number;
  maxWsMessages: number;
}): TargetNetworkReport["hints"] {
  const shouldRecapture = opts.droppedRequests > 0 || opts.droppedWebSockets > 0 || opts.droppedWsMessages > 0;
  return {
    shouldRecapture,
    suggested: {
      maxRequests: opts.droppedRequests > 0 ? Math.min(NETWORK_MAX_REQUESTS_CAP, opts.maxRequests * 2) : opts.maxRequests,
      maxWebSockets:
        opts.droppedWebSockets > 0 ? Math.min(NETWORK_MAX_WEBSOCKETS_CAP, opts.maxWebSockets * 2) : opts.maxWebSockets,
      maxWsMessages:
        opts.droppedWsMessages > 0
          ? Math.min(NETWORK_MAX_WS_MESSAGES_CAP, opts.maxWsMessages * 2)
          : opts.maxWsMessages,
    },
  };
}

export function toTableRows(
  requests: TargetNetworkRequestReport[],
  fields: string[],
): TargetNetworkReport["tableRows"] {
  return requests.slice(0, NETWORK_TABLE_ROWS_LIMIT).map((request) => {
    const row: Record<string, string | number | boolean | null> = {};
    for (const field of fields) {
      const key = field.trim();
      if (!key) {
        continue;
      }
      if (key in request) {
        row[key] = request[key as keyof TargetNetworkRequestReport] as string | number | boolean | null;
      } else {
        row[key] = null;
      }
    }
    return row;
  });
}
