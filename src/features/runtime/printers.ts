import type {
  DoctorReport,
  SessionListReport,
  SessionPruneReport,
  SessionReport,
  StateDiskPruneReport,
  StateReconcileReport,
  WorkspaceInfoReport,
  WorkspaceInitReport,
  WorkspaceProfileLockClearReport,
  WorkspaceProfileLocksReport,
} from "../../core/types.js";

export type RuntimeOutputOpts = {
  json: boolean;
  pretty: boolean;
};

type ContractCommandLike = {
  id?: unknown;
  usage?: unknown;
};

type ContractErrorLike = {
  code?: unknown;
  retryable?: unknown;
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

export function printContractReport(report: Record<string, unknown>, opts: RuntimeOutputOpts) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }
  const name = typeof report.name === "string" ? report.name : "surfwright";
  const version = typeof report.version === "string" ? report.version : "unknown";
  const schemaVersion =
    typeof report.contractSchemaVersion === "number" ? report.contractSchemaVersion : "unknown";
  const fingerprint =
    typeof report.contractFingerprint === "string" ? report.contractFingerprint : "unknown";
  const commands = Array.isArray(report.commands) ? report.commands : [];
  const errors = Array.isArray(report.errors) ? report.errors : [];
  const guarantees = Array.isArray(report.guarantees) ? report.guarantees : [];
  const commandIds = Array.isArray(report.commandIds) ? report.commandIds : null;
  const errorCodes = Array.isArray(report.errorCodes) ? report.errorCodes : null;
  const lines = [
    `${name} contract v${version}`,
    `schema: ${schemaVersion}`,
    `fingerprint: ${fingerprint}`,
    "",
    ...(commandIds
      ? ["commandIds:", ...commandIds.map((id) => `- ${String(id)}`)]
      : [
          "commands:",
          ...commands.map((command) => {
            const entry = (command ?? {}) as ContractCommandLike;
            return `- ${String(entry.id)}: ${String(entry.usage)}`;
          }),
        ]),
    "",
    ...(errorCodes
      ? ["errorCodes:", ...errorCodes.map((code) => `- ${String(code)}`)]
      : [
          "typed errors:",
          ...errors.map((error) => {
            const entry = (error ?? {}) as ContractErrorLike;
            return `- ${String(entry.code)} (retryable=${entry.retryable ? "true" : "false"})`;
          }),
        ]),
  ];
  if (guarantees.length > 0) {
    lines.push("", "guarantees:", ...guarantees.map((entry) => `- ${String(entry)}`));
  }
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
  const profile = typeof report.profile === "string" ? report.profile : null;
  process.stdout.write(
    [
      "ok",
      `sessionId=${sessionId}`,
      `targetId=${targetId}`,
      `actionId=${actionId}`,
      `status=${status}`,
      `url=${url}`,
      ...(browserMode ? [`browserMode=${browserMode}`] : []),
      ...(profile ? [`profile=${profile}`] : []),
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
      ...(report.profile ? [`profile=${report.profile}`] : []),
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

export function printStateDiskPruneSuccess(report: StateDiskPruneReport, opts: RuntimeOutputOpts) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }
  process.stdout.write(
    [
      "ok",
      `bytesFreed=${report.totalBytesFreed}`,
      `runsRemoved=${report.runs.removed}`,
      `capturesRemoved=${report.captures.removed}`,
      `orphanProfilesRemoved=${report.orphanProfiles.removed}`,
      `workspaceProfilesRemoved=${report.workspaceProfiles.removed}`,
      `dryRun=${report.dryRun ? "true" : "false"}`,
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

export function printWorkspaceSuccess(
  report: WorkspaceInfoReport | WorkspaceInitReport | WorkspaceProfileLocksReport | WorkspaceProfileLockClearReport,
  opts: RuntimeOutputOpts,
) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }
  if ("locks" in report) {
    if (!report.found) {
      process.stdout.write(`workspace not found\n${report.hint ?? ""}\n`.trimEnd() + "\n");
      return;
    }
    process.stdout.write(["ok", `locks=${report.locks.length}`].join(" ") + "\n");
    return;
  }
  if ("cleared" in report) {
    if (!report.found) {
      process.stdout.write(`workspace not found\n${report.hint ?? ""}\n`.trimEnd() + "\n");
      return;
    }
    process.stdout.write(
      ["ok", `profile=${report.profile}`, `cleared=${report.cleared ? "true" : "false"}`, `reason=${report.reason}`].join(
        " ",
      ) + "\n",
    );
    return;
  }
  if ("found" in report) {
    if (!report.found) {
      process.stdout.write(`workspace not found\n${report.hint ?? ""}\n`.trimEnd() + "\n");
      return;
    }
    process.stdout.write(
      [
        "ok",
        `workspaceDir=${report.workspaceDir ?? "null"}`,
        `profilesDir=${report.profilesDir ?? "null"}`,
      ].join(" ") + "\n",
    );
    return;
  }
  process.stdout.write(
    [
      "ok",
      `workspaceDir=${report.workspaceDir}`,
      `profilesDir=${report.profilesDir}`,
      `gitignoreUpdated=${report.gitignore.updated ? "true" : "false"}`,
    ].join(" ") + "\n",
  );
}
