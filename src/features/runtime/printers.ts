import type {
  CliContractReport,
  DoctorReport,
  SessionListReport,
  SessionPruneReport,
  SessionReport,
  StateReconcileReport,
} from "../../core/types.js";

export type RuntimeOutputOpts = {
  json: boolean;
  pretty: boolean;
};

function writeJson(value: unknown, opts: { pretty: boolean }) {
  process.stdout.write(`${JSON.stringify(value, null, opts.pretty ? 2 : 0)}\n`);
}

export function printDoctorReport(report: DoctorReport, opts: RuntimeOutputOpts) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }

  const lines = [
    "surfwright doctor",
    "",
    `node: ${report.node.version} (${report.node.platform}/${report.node.arch})`,
    `chrome: ${report.chrome.found ? "found" : "missing"}`,
    ...(report.chrome.found
      ? []
      : [
          "",
          "Looked for:",
          ...report.chrome.candidates.map((candidatePath) => `- ${candidatePath}`),
        ]),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function printContractReport(report: CliContractReport, opts: RuntimeOutputOpts) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }
  const lines = [
    `${report.name} contract v${report.version}`,
    `schema: ${report.contractSchemaVersion}`,
    `fingerprint: ${report.contractFingerprint}`,
    "",
    "commands:",
    ...report.commands.map((command) => `- ${command.id}: ${command.usage}`),
    "",
    "typed errors:",
    ...report.errors.map((error) => `- ${error.code} (retryable=${error.retryable ? "true" : "false"})`),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function printOpenSuccess(report: Record<string, unknown>, opts: RuntimeOutputOpts) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }
  const sessionId = typeof report.sessionId === "string" ? report.sessionId : "unknown";
  const targetId = typeof report.targetId === "string" ? report.targetId : "unknown";
  const actionId = typeof report.actionId === "string" ? report.actionId : "unknown";
  const status = typeof report.status === "number" ? String(report.status) : "null";
  const url = typeof report.url === "string" ? report.url : "unknown";
  const browserMode = typeof report.browserMode === "string" ? report.browserMode : null;
  process.stdout.write(
    [
      "ok",
      `sessionId=${sessionId}`,
      `targetId=${targetId}`,
      `actionId=${actionId}`,
      `status=${status}`,
      `url=${url}`,
      ...(browserMode ? [`browserMode=${browserMode}`] : []),
    ].join(" ") + "\n",
  );
}

export function printSessionSuccess(report: SessionReport | SessionListReport | SessionPruneReport, opts: RuntimeOutputOpts) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }
  if ("removedAttachedUnreachable" in report) {
    process.stdout.write(
      [
        "ok",
        `activeSessionId=${report.activeSessionId ?? "none"}`,
        `scanned=${report.scanned}`,
        `kept=${report.kept}`,
        `removed=${report.removed}`,
      ].join(" ") + "\n",
    );
    return;
  }
  if ("sessions" in report) {
    process.stdout.write(`ok activeSessionId=${report.activeSessionId ?? "none"} sessions=${report.sessions.length}\n`);
    return;
  }
  process.stdout.write(
    [
      "ok",
      `sessionId=${report.sessionId}`,
      `kind=${report.kind}`,
      `browserMode=${report.browserMode}`,
      `active=${report.active ? "true" : "false"}`,
      `created=${report.created ? "true" : "false"}`,
      `restarted=${report.restarted ? "true" : "false"}`,
    ].join(" ") + "\n",
  );
}

export function printStateReconcileSuccess(report: StateReconcileReport, opts: RuntimeOutputOpts) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }
  process.stdout.write(
    [
      "ok",
      `activeSessionId=${report.activeSessionId ?? "none"}`,
      `sessionsRemoved=${report.sessions.removed}`,
      `targetsRemoved=${report.targets.removed}`,
    ].join(" ") + "\n",
  );
}

export function printRunSuccess(report: Record<string, unknown>, opts: RuntimeOutputOpts) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }
  if (report.mode === "doctor") {
    const valid = report.valid === true;
    const issues = Array.isArray(report.issues) ? report.issues.length : 0;
    process.stdout.write(["ok", "mode=doctor", `valid=${valid ? "true" : "false"}`, `issues=${issues}`].join(" ") + "\n");
    return;
  }
  const steps = Array.isArray(report.steps) ? report.steps.length : 0;
  const sessionId = typeof report.sessionId === "string" ? report.sessionId : "none";
  const targetId = typeof report.targetId === "string" ? report.targetId : "none";
  const totalMs = typeof report.totalMs === "number" ? report.totalMs : 0;
  process.stdout.write(["ok", `steps=${steps}`, `sessionId=${sessionId}`, `targetId=${targetId}`, `totalMs=${totalMs}`].join(" ") + "\n");
}

