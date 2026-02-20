import type { CliContractReport } from "../../core/types.js";

function filterContractReport(report: CliContractReport, needle: string): CliContractReport {
  if (needle.length === 0) {
    return report;
  }
  return {
    ...report,
    commands: report.commands.filter((entry) => [entry.id, entry.summary, entry.usage].some((value) => value.toLowerCase().includes(needle))),
    errors: report.errors.filter((entry) => [entry.code, entry.message].some((value) => value.toLowerCase().includes(needle))),
    guidance: Array.isArray(report.guidance)
      ? report.guidance.filter((entry) => [entry.id, entry.signature, ...entry.examples].some((value) => value.toLowerCase().includes(needle)))
      : report.guidance,
  };
}

function compactContractReport(report: CliContractReport, needle: string): Record<string, unknown> {
  return {
    ok: true,
    name: report.name,
    version: report.version,
    contractSchemaVersion: report.contractSchemaVersion,
    contractFingerprint: report.contractFingerprint,
    commandCount: report.commands.length,
    errorCount: report.errors.length,
    guarantees: report.guarantees,
    commandIds: report.commands.map((entry) => entry.id),
    errorCodes: report.errors.map((entry) => entry.code),
    search: needle.length > 0 ? needle : null,
  };
}

export function buildContractOutput(opts: {
  report: CliContractReport;
  compact?: boolean;
  search?: string;
}): CliContractReport | Record<string, unknown> {
  const needle = typeof opts.search === "string" ? opts.search.trim().toLowerCase() : "";
  const filtered = filterContractReport(opts.report, needle);
  if (opts.compact) {
    return compactContractReport(filtered, needle);
  }
  return filtered;
}
