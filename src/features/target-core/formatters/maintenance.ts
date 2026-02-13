function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function printTargetMaintenanceSuccess(report: unknown): boolean {
  if (!isRecord(report)) {
    return false;
  }

  if ("artifacts" in report && Array.isArray(report.artifacts)) {
    const total = typeof report.total === "number" ? report.total : report.artifacts.length;
    const returned = typeof report.returned === "number" ? report.returned : report.artifacts.length;
    process.stdout.write(["ok", `total=${total}`, `returned=${returned}`].join(" ") + "\n");
    return true;
  }

  if ("removedMissingFiles" in report) {
    const before = typeof report.totalBefore === "number" ? report.totalBefore : 0;
    const after = typeof report.totalAfter === "number" ? report.totalAfter : 0;
    const removed = typeof report.removed === "number" ? report.removed : 0;
    process.stdout.write(["ok", `before=${before}`, `after=${after}`, `removed=${removed}`].join(" ") + "\n");
    return true;
  }

  if ("removedOrphaned" in report) {
    const activeSessionId = typeof report.activeSessionId === "string" ? report.activeSessionId : "none";
    const scanned = typeof report.scanned === "number" ? report.scanned : 0;
    const remaining = typeof report.remaining === "number" ? report.remaining : 0;
    const removed = typeof report.removed === "number" ? report.removed : 0;
    process.stdout.write(
      ["ok", `activeSessionId=${activeSessionId}`, `scanned=${scanned}`, `remaining=${remaining}`, `removed=${removed}`].join(" ") + "\n",
    );
    return true;
  }

  return false;
}
