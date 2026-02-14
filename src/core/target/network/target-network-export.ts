import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { CliError } from "../../errors.js";
import { recordNetworkArtifact } from "./target-network-artifacts.js";
import { targetNetworkCaptureEnd } from "./target-network-capture.js";
import { targetNetwork } from "./target-network.js";
import { writeHarFile } from "./target-network-har.js";
import { resolveNetworkReportSource } from "./target-network-source.js";
import type {
  TargetNetworkExportReport,
  TargetNetworkReport,
  TargetTraceExportReport,
  TargetTraceInsightReport,
} from "../../types.js";

function parseOutPath(input: string): string {
  const value = input.trim();
  if (!value) {
    throw new CliError("E_QUERY_INVALID", "out must not be empty");
  }
  return path.resolve(value);
}

function parseFormat(input: string | undefined): "har" {
  if (typeof input === "undefined") {
    return "har";
  }
  const value = input.trim().toLowerCase();
  if (value !== "har") {
    throw new CliError("E_QUERY_INVALID", "format must be har");
  }
  return "har";
}

function parseTraceId(input: string): string {
  const value = input.trim();
  if (!/^c-[0-9]+$/.test(value)) {
    throw new CliError("E_QUERY_INVALID", "trace-id is invalid");
  }
  return value;
}

function parseTraceFormat(input: string | undefined, outPath: string): { format: "json"; gzip: boolean } {
  if (typeof input === "undefined") {
    return {
      format: "json",
      gzip: outPath.toLowerCase().endsWith(".gz"),
    };
  }
  const value = input.trim().toLowerCase();
  if (value === "json") {
    return { format: "json", gzip: false };
  }
  if (value === "json.gz") {
    return { format: "json", gzip: true };
  }
  throw new CliError("E_QUERY_INVALID", "format must be json or json.gz");
}

function buildTracePayload(report: TargetNetworkReport, traceId: string | null) {
  return {
    ok: true,
    traceId,
    sessionId: report.sessionId,
    targetId: report.targetId,
    url: report.url,
    title: report.title,
    capture: report.capture,
    counts: report.counts,
    performance: report.performance,
    insights: report.insights,
    requests: report.requests,
    webSockets: report.webSockets,
  };
}

function buildTraceInsight(report: TargetNetworkReport): TargetTraceInsightReport["insight"] {
  const errorHotspot = report.insights.errorHotspots[0];
  if (errorHotspot && errorHotspot.failures > 0) {
    return {
      name: "error-hotspot",
      summary: `Failures cluster at ${errorHotspot.url}`,
      severity: errorHotspot.status5xx > 0 ? "high" : "medium",
      evidence: {
        failures: errorHotspot.failures,
        status4xx: errorHotspot.status4xx,
        status5xx: errorHotspot.status5xx,
      },
    };
  }

  const p95 = report.performance.latencyMs.p95;
  if (typeof p95 === "number" && Number.isFinite(p95) && p95 >= 1000) {
    return {
      name: "latency-tail",
      summary: `High tail latency detected (p95 ${p95}ms)`,
      severity: p95 >= 2500 ? "high" : "medium",
      evidence: {
        p95LatencyMs: p95,
        completedRequests: report.performance.completedRequests,
      },
    };
  }

  const slowest = report.performance.slowest[0];
  if (slowest && slowest.durationMs >= 800) {
    return {
      name: "slow-request",
      summary: `Slow request observed at ${slowest.url}`,
      severity: slowest.durationMs >= 2500 ? "high" : "low",
      evidence: {
        durationMs: slowest.durationMs,
        status: slowest.status,
        resourceType: slowest.resourceType,
      },
    };
  }

  const topHost = report.insights.topHosts[0];
  if (topHost) {
    return {
      name: "top-host",
      summary: `${topHost.host} handled the most requests`,
      severity: "info",
      evidence: {
        requests: topHost.requests,
        failures: topHost.failures,
        avgLatencyMs: topHost.avgLatencyMs,
      },
    };
  }

  return {
    name: "stable-trace",
    summary: "No standout latency or error hotspot detected in this capture",
    severity: "info",
    evidence: {
      requests: report.counts.requestsReturned,
      failed: report.counts.failedSeen,
      p95LatencyMs: report.performance.latencyMs.p95,
    },
  };
}

export async function targetNetworkExport(opts: {
  targetId: string;
  timeoutMs: number;
  outPath: string;
  format?: string;
  sessionId?: string;
  captureId?: string | null;
  actionId?: string;
  profile?: string;
  captureMs?: number;
  maxRequests?: number;
  view?: string;
  fields?: string;
  reload?: boolean;
  urlContains?: string;
  method?: string;
  resourceType?: string;
  status?: string;
  failedOnly?: boolean;
}): Promise<TargetNetworkExportReport> {
  const format = parseFormat(opts.format);
  const outputPath = parseOutPath(opts.outPath);

  const capture = await targetNetwork({
    targetId: opts.targetId,
    timeoutMs: opts.timeoutMs,
    sessionId: opts.sessionId,
    captureId: opts.captureId ?? null,
    actionId: opts.actionId,
    profile: opts.profile,
    view: opts.view,
    fields: opts.fields,
    captureMs: opts.captureMs,
    maxRequests: opts.maxRequests,
    reload: opts.reload,
    urlContains: opts.urlContains,
    method: opts.method,
    resourceType: opts.resourceType,
    status: opts.status,
    failedOnly: opts.failedOnly,
  });

  const captureStartEpochMs = Date.parse(capture.capture.startedAt);
  const artifact = await writeHarFile({
    outputPath,
    captureStartEpochMs: Number.isFinite(captureStartEpochMs) ? captureStartEpochMs : Date.now(),
    captureStartedAtIso: capture.capture.startedAt,
    pageTitle: capture.title,
    pageUrl: capture.url,
    targetId: capture.targetId,
    requests: capture.requests,
  });
  const report: TargetNetworkExportReport = {
    ok: true,
    sessionId: capture.sessionId,
    sessionSource: capture.sessionSource,
    targetId: capture.targetId,
    url: capture.url,
    title: capture.title,
    format,
    artifact,
    source: {
      captureMs: capture.capture.captureMs,
      requestsSeen: capture.counts.requestsSeen,
      requestsReturned: capture.counts.requestsReturned,
      truncatedRequests: capture.truncated.requests,
    },
  };
  await recordNetworkArtifact({
    report,
    captureId: opts.captureId ?? null,
  });
  return report;
}

export async function targetTraceExport(opts: {
  timeoutMs: number;
  outPath: string;
  traceId?: string;
  targetId?: string;
  sessionId?: string;
  profile?: string;
  captureMs?: number;
  format?: string;
}): Promise<TargetTraceExportReport> {
  const startedAt = Date.now();
  const outputPath = parseOutPath(opts.outPath);
  const parsedFormat = parseTraceFormat(opts.format, outputPath);

  let capture: TargetNetworkReport;
  let traceId: string | null = null;
  if (typeof opts.traceId === "string" && opts.traceId.trim().length > 0) {
    traceId = parseTraceId(opts.traceId);
    capture = await targetNetworkCaptureEnd({
      captureId: traceId,
      timeoutMs: opts.timeoutMs,
      profile: opts.profile ?? "perf",
      view: "raw",
    });
  } else if (typeof opts.targetId === "string" && opts.targetId.trim().length > 0) {
    capture = await targetNetwork({
      targetId: opts.targetId,
      timeoutMs: opts.timeoutMs,
      sessionId: opts.sessionId,
      profile: opts.profile ?? "perf",
      view: "raw",
      captureMs: opts.captureMs,
    });
    traceId = capture.captureId;
  } else {
    throw new CliError("E_QUERY_INVALID", "Provide targetId or --trace-id");
  }
  const captureCompletedAt = Date.now();

  const tracePayload = JSON.stringify(buildTracePayload(capture, traceId));
  const body = parsedFormat.gzip
    ? zlib.gzipSync(Buffer.from(tracePayload, "utf8"))
    : Buffer.from(`${tracePayload}\n`, "utf8");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, body);
  const fileWrittenAt = Date.now();

  return {
    ok: true,
    sessionId: capture.sessionId,
    targetId: capture.targetId,
    traceId,
    out: outputPath,
    format: parsedFormat.format,
    gzip: parsedFormat.gzip,
    bytes: body.byteLength,
    timingMs: {
      total: fileWrittenAt - startedAt,
      capture: captureCompletedAt - startedAt,
      writeFile: fileWrittenAt - captureCompletedAt,
    },
  };
}

export async function targetTraceInsight(opts: {
  timeoutMs: number;
  traceId?: string;
  artifactId?: string;
  targetId?: string;
  sessionId?: string;
  profile?: string;
  captureMs?: number;
}): Promise<TargetTraceInsightReport> {
  let sourceKind: TargetTraceInsightReport["source"]["kind"];
  let sourceId: string;
  let traceId: string | null = null;
  let report: TargetNetworkReport;

  if (typeof opts.traceId === "string" && opts.traceId.trim().length > 0) {
    const parsedTraceId = parseTraceId(opts.traceId);
    const ended = await targetNetworkCaptureEnd({
      captureId: parsedTraceId,
      timeoutMs: opts.timeoutMs,
      profile: opts.profile ?? "perf",
      view: "summary",
    });
    sourceKind = "capture";
    sourceId = parsedTraceId;
    traceId = parsedTraceId;
    report = ended;
  } else if (typeof opts.targetId === "string" && opts.targetId.trim().length > 0) {
    const live = await targetNetwork({
      targetId: opts.targetId,
      timeoutMs: opts.timeoutMs,
      sessionId: opts.sessionId,
      profile: opts.profile ?? "perf",
      view: "summary",
      captureMs: opts.captureMs,
    });
    sourceKind = "live";
    sourceId = opts.targetId;
    traceId = live.captureId;
    report = live;
  } else {
    const source = resolveNetworkReportSource({
      artifactId: opts.artifactId,
    });
    sourceKind = source.source.kind;
    sourceId = source.source.id;
    traceId = source.source.kind === "capture" ? source.source.id : source.report.captureId;
    report = source.report;
  }

  return {
    ok: true,
    traceId,
    source: {
      kind: sourceKind,
      id: sourceId,
    },
    insight: buildTraceInsight(report),
  };
}
