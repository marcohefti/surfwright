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
    "failureReason",
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function commandToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const stripped = value.trim().replace(/^(?:\$|#|>)\s*/, "");
  if (stripped.length < 1) {
    return null;
  }
  const token = stripped.split(/\s+/)[0]?.trim() ?? "";
  return token.length > 0 ? token : null;
}

function deriveExtractProof(report: Record<string, unknown>): Record<string, unknown> | null {
  const kind = typeof report.kind === "string" ? report.kind : "";
  const hasExtractKind =
    kind === "generic" ||
    kind === "blog" ||
    kind === "news" ||
    kind === "docs" ||
    kind === "docs-commands" ||
    kind === "headings" ||
    kind === "links" ||
    kind === "codeblocks" ||
    kind === "forms" ||
    kind === "tables" ||
    kind === "table-rows";
  if (!hasExtractKind) {
    return null;
  }

  const count = typeof report.count === "number" ? report.count : null;
  const items = Array.isArray(report.items) ? report.items : null;
  if (count === null && !items) {
    return null;
  }
  const firstItem = items?.[0];
  const firstItemRecord = asRecord(firstItem);
  const firstTitle = typeof firstItemRecord?.title === "string" ? firstItemRecord.title : null;
  const firstUrl = typeof firstItemRecord?.url === "string" ? firstItemRecord.url : null;
  const firstCommand = commandToken(firstItemRecord?.command);
  const source = report.source === "dom" || report.source === "api-feed" ? report.source : null;
  return {
    count: count ?? 0,
    itemCount: items?.length ?? 0,
    totalRawCount: count ?? 0,
    truncated: Boolean(report.truncated),
    firstTitle,
    firstUrl,
    firstCommand,
    source,
  };
}

function deriveEvalProof(report: Record<string, unknown>): Record<string, unknown> | null {
  const result = asRecord(report.result);
  if (!result) {
    return null;
  }
  const context = asRecord(report.context);
  const consoleObj = asRecord(report.console);
  return {
    resultType: typeof result.type === "string" ? result.type : "unknown",
    resultValue: Object.prototype.hasOwnProperty.call(result, "value") ? result.value : null,
    resultTruncated: Boolean(result.truncated),
    consoleCount: typeof consoleObj?.count === "number" ? consoleObj.count : 0,
    consoleCaptured: Boolean(consoleObj?.captured),
    evaluatedFrameId: typeof context?.evaluatedFrameId === "string" ? context.evaluatedFrameId : null,
  };
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
    deriveExtractProof(report) ??
    deriveEvalProof(report) ??
    (Object.prototype.hasOwnProperty.call(report, "downloadStarted")
      ? {
          downloadStarted: report.downloadStarted,
          downloadStatus: report.downloadStatus,
          downloadFinalUrl: report.downloadFinalUrl,
          downloadFileName: report.downloadFileName,
          downloadBytes: report.downloadBytes,
          failureReason: report.failureReason,
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
