import { CliError } from "./errors.js";

export type ReportOutputShape = "full" | "compact" | "proof";
let runtimeOutputShapeInput: string | undefined;

export function setRuntimeOutputShapeInput(input: string | undefined): void {
  runtimeOutputShapeInput = input;
}

function parseOutputShape(input: string | undefined): ReportOutputShape {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (value.length === 0 || value === "full") {
    return "full";
  }
  if (value === "compact" || value === "proof") {
    return value;
  }
  throw new CliError("E_QUERY_INVALID", "output-shape must be one of: full, compact, proof");
}

function compactKeys(): string[] {
  return [
    "ok",
    "sessionId",
    "targetId",
    "actionId",
    "requestedUrl",
    "finalUrl",
    "url",
    "title",
    "status",
    "downloadStarted",
    "downloadStatus",
    "downloadFinalUrl",
    "downloadFileName",
    "downloadBytes",
    "mode",
    "query",
    "selector",
    "matchCount",
    "pickedIndex",
    "repeat",
    "wait",
    "proofEnvelope",
    "proof",
    "summary",
    "click",
    "read",
    "timingMs",
  ];
}

function applyOutputShape(report: Record<string, unknown>, shape: ReportOutputShape): Record<string, unknown> {
  if (shape === "full") {
    return report;
  }
  const out: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(report, "ok")) {
    out.ok = report.ok;
  }
  if (shape === "compact") {
    for (const key of compactKeys()) {
      if (key === "ok") {
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(report, key)) {
        out[key] = report[key];
      }
    }
    return out;
  }
  // proof shape
  const proof = Object.prototype.hasOwnProperty.call(report, "proofEnvelope")
    ? report.proofEnvelope
    : Object.prototype.hasOwnProperty.call(report, "proof")
      ? report.proof
      : null;
  const derivedProof =
    proof ??
    (Object.prototype.hasOwnProperty.call(report, "summary") ? report.summary : null) ??
    (Object.prototype.hasOwnProperty.call(report, "downloadStarted")
      ? {
          downloadStarted: report.downloadStarted,
          downloadStatus: report.downloadStatus,
          downloadFinalUrl: report.downloadFinalUrl,
          downloadFileName: report.downloadFileName,
          downloadBytes: report.downloadBytes,
        }
      : null);
  if (Object.prototype.hasOwnProperty.call(report, "sessionId")) {
    out.sessionId = report.sessionId;
  }
  if (Object.prototype.hasOwnProperty.call(report, "targetId")) {
    out.targetId = report.targetId;
  }
  if (Object.prototype.hasOwnProperty.call(report, "actionId")) {
    out.actionId = report.actionId;
  }
  if (Object.prototype.hasOwnProperty.call(report, "url")) {
    out.url = report.url;
  }
  if (Object.prototype.hasOwnProperty.call(report, "finalUrl")) {
    out.finalUrl = report.finalUrl;
  }
  if (Object.prototype.hasOwnProperty.call(report, "repeat")) {
    out.repeat = report.repeat;
  }
  out.proof = derivedProof;
  return out;
}

export function parseFieldsCsv(input: string | undefined): string[] | null {
  if (typeof input !== "string") {
    return null;
  }

  const fields = input
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (fields.length === 0) {
    throw new CliError("E_QUERY_INVALID", "fields must contain at least one field name");
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field)) {
      continue;
    }
    seen.add(field);
    unique.push(field);
  }
  return unique;
}

export function projectReportFields<T extends Record<string, unknown>>(report: T, fields: string[] | null): Record<string, unknown> {
  const outputShape = parseOutputShape(runtimeOutputShapeInput);
  const shaped = applyOutputShape(report, outputShape);
  if (!fields || fields.length === 0) {
    return shaped;
  }

  const projected: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(shaped, "ok")) {
    projected.ok = shaped.ok;
  }

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(shaped, field)) {
      continue;
    }
    projected[field] = shaped[field];
  }

  return projected;
}
