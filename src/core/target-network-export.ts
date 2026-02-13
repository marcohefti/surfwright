import path from "node:path";
import { CliError } from "./errors.js";
import { recordNetworkArtifact } from "./target-network-artifacts.js";
import { targetNetwork } from "./target-network.js";
import { writeHarFile } from "./target-network-har.js";
import type { TargetNetworkExportReport } from "./types.js";

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
