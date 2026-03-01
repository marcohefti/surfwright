import type { CliContractReport } from "../../core/types.js";
import { buildCommandSignature, usageCommandPath } from "../../core/cli-contract.js";

function withCommandSurfaceFields(report: CliContractReport): CliContractReport {
  return {
    ...report,
    commands: report.commands.map((entry) => {
      const argvPath = usageCommandPath(entry.usage);
      return {
        ...entry,
        commandPath: argvPath.join(" "),
        argvPath,
        dotAlias: entry.id.includes(".") ? entry.id : null,
      };
    }),
  };
}

function compactContractReport(report: CliContractReport): Record<string, unknown> {
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
  };
}

export function buildContractOutput(opts: {
  report: CliContractReport;
  mode?: "compact" | "command" | "commands";
  commandId?: string;
  commandIds?: string[];
}): CliContractReport | Record<string, unknown> {
  const surfaced = withCommandSurfaceFields(opts.report);
  if (opts.mode === "command") {
    const commandId = typeof opts.commandId === "string" ? opts.commandId.trim() : "";
    const command = surfaced.commands.find((entry) => entry.id === commandId) ?? null;
    if (!command) {
      return compactContractReport(surfaced);
    }
    const examples = Array.isArray(surfaced.guidance) ? surfaced.guidance.find((entry) => entry.id === commandId)?.examples ?? [] : [];
    return {
      ok: true,
      name: surfaced.name,
      version: surfaced.version,
      contractSchemaVersion: surfaced.contractSchemaVersion,
      contractFingerprint: surfaced.contractFingerprint,
      mode: "command",
      command: buildCommandSignature({
        command,
        examples,
      }),
    };
  }
  if (opts.mode === "commands") {
    const commandIds = Array.isArray(opts.commandIds) ? opts.commandIds : [];
    const commands = commandIds
      .map((commandId) => {
        const command = surfaced.commands.find((entry) => entry.id === commandId);
        if (!command) {
          return null;
        }
        const examples = Array.isArray(surfaced.guidance)
          ? surfaced.guidance.find((entry) => entry.id === commandId)?.examples ?? []
          : [];
        return buildCommandSignature({
          command,
          examples,
        });
      })
      .filter((entry): entry is ReturnType<typeof buildCommandSignature> => entry !== null);
    return {
      ok: true,
      name: surfaced.name,
      version: surfaced.version,
      contractSchemaVersion: surfaced.contractSchemaVersion,
      contractFingerprint: surfaced.contractFingerprint,
      mode: "commands",
      commandCount: commands.length,
      commands,
    };
  }
  return compactContractReport(surfaced);
}
