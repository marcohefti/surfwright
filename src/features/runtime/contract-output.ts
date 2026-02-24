import type { CliContractReport } from "../../core/types.js";

const CORE_COMMAND_IDS = new Set([
  "contract",
  "session.fresh",
  "session.clear",
  "open",
  "target.snapshot",
  "target.find",
  "target.count",
  "target.attr",
  "target.click",
  "target.click-read",
  "target.read",
  "target.extract",
  "target.fill",
  "target.wait",
  "target.scroll-plan",
  "target.scroll-sample",
  "target.scroll-watch",
  "run",
]);

const CORE_ERROR_CODES = new Set([
  "E_QUERY_INVALID",
  "E_ASSERT_FAILED",
  "E_WAIT_TIMEOUT",
  "E_TARGET_SESSION_UNKNOWN",
  "E_SELECTOR_INVALID",
  "E_CDP_UNREACHABLE",
  "E_INTERNAL",
]);

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

function coreContractReport(report: CliContractReport, needle: string): Record<string, unknown> {
  const commands = report.commands.filter((entry) => CORE_COMMAND_IDS.has(entry.id));
  const errors = report.errors.filter((entry) => CORE_ERROR_CODES.has(entry.code));
  const guidance = Array.isArray(report.guidance)
    ? report.guidance.filter((entry) => CORE_COMMAND_IDS.has(entry.id))
    : [];
  return {
    ok: true,
    name: report.name,
    version: report.version,
    contractSchemaVersion: report.contractSchemaVersion,
    contractFingerprint: report.contractFingerprint,
    mode: "core",
    guarantees: report.guarantees,
    commandCount: commands.length,
    errorCount: errors.length,
    commands,
    errors,
    guidance,
    search: needle.length > 0 ? needle : null,
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
  mode?: "compact" | "core" | "full";
  search?: string;
}): CliContractReport | Record<string, unknown> {
  const needle = typeof opts.search === "string" ? opts.search.trim().toLowerCase() : "";
  const filtered = filterContractReport(opts.report, needle);
  if (opts.mode === "core") {
    return coreContractReport(filtered, needle);
  }
  if (opts.mode !== "full") {
    return compactContractReport(filtered, needle);
  }
  return filtered;
}
