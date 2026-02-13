import { CliError } from "./errors.js";

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
  if (!fields || fields.length === 0) {
    return report;
  }

  const projected: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(report, "ok")) {
    projected.ok = report.ok;
  }

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(report, field)) {
      continue;
    }
    projected[field] = report[field];
  }

  return projected;
}
