import { type Command } from "commander";
import {
  getDoctorReport,
  openUrl,
  parseFieldsCsv,
  projectReportFields,
  runPipeline,
  sessionAttach,
  sessionEnsure,
  sessionList,
  sessionNew,
  sessionPrune,
  sessionUse,
  stateReconcile,
} from "../../core/usecases.js";
import {
  DEFAULT_OPEN_TIMEOUT_MS,
  DEFAULT_SESSION_TIMEOUT_MS,
  type CliContractReport,
  type DoctorReport,
  type SessionListReport,
  type SessionPruneReport,
  type SessionReport,
  type StateReconcileReport,
} from "../../core/types.js";
import { getCliContractReport } from "../../core/cli-contract.js";
import { runtimeCommandMeta } from "./manifest.js";

type RuntimeOutputOpts = {
  json: boolean;
  pretty: boolean;
};

type RuntimeCommandContext = {
  program: Command;
  parseTimeoutMs: (input: string) => number;
  globalOutputOpts: () => RuntimeOutputOpts;
  handleFailure: (error: unknown, outputOpts: RuntimeOutputOpts) => void;
  readPackageVersion: () => string;
};

function parseLeaseTtlMs(input: string): number {
  const value = Number.parseInt(input, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("lease-ttl-ms must be a positive integer");
  }
  return value;
}

function writeJson(value: unknown, opts: { pretty: boolean }) {
  process.stdout.write(`${JSON.stringify(value, null, opts.pretty ? 2 : 0)}\n`);
}

function printDoctorReport(report: DoctorReport, opts: RuntimeOutputOpts) {
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

function printContractReport(report: CliContractReport, opts: RuntimeOutputOpts) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }
  const lines = [
    `${report.name} contract v${report.version}`,
    "",
    "commands:",
    ...report.commands.map((command) => `- ${command.id}: ${command.usage}`),
    "",
    "typed errors:",
    ...report.errors.map((error) => `- ${error.code} (retryable=${error.retryable ? "true" : "false"})`),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function printOpenSuccess(report: Record<string, unknown>, opts: RuntimeOutputOpts) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }
  const sessionId = typeof report.sessionId === "string" ? report.sessionId : "unknown";
  const targetId = typeof report.targetId === "string" ? report.targetId : "unknown";
  const actionId = typeof report.actionId === "string" ? report.actionId : "unknown";
  const status = typeof report.status === "number" ? String(report.status) : "null";
  const url = typeof report.url === "string" ? report.url : "unknown";
  process.stdout.write(
    [
      "ok",
      `sessionId=${sessionId}`,
      `targetId=${targetId}`,
      `actionId=${actionId}`,
      `status=${status}`,
      `url=${url}`,
    ].join(" ") + "\n",
  );
}

function printSessionSuccess(report: SessionReport | SessionListReport | SessionPruneReport, opts: RuntimeOutputOpts) {
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
      `active=${report.active ? "true" : "false"}`,
      `created=${report.created ? "true" : "false"}`,
      `restarted=${report.restarted ? "true" : "false"}`,
    ].join(" ") + "\n",
  );
}

function printStateReconcileSuccess(report: StateReconcileReport, opts: RuntimeOutputOpts) {
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

function printRunSuccess(report: Record<string, unknown>, opts: RuntimeOutputOpts) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }
  const steps = Array.isArray(report.steps) ? report.steps.length : 0;
  const sessionId = typeof report.sessionId === "string" ? report.sessionId : "none";
  const targetId = typeof report.targetId === "string" ? report.targetId : "none";
  const totalMs = typeof report.totalMs === "number" ? report.totalMs : 0;
  process.stdout.write(["ok", `steps=${steps}`, `sessionId=${sessionId}`, `targetId=${targetId}`, `totalMs=${totalMs}`].join(" ") + "\n");
}

export function registerRuntimeCommands(ctx: RuntimeCommandContext) {
  const doctorMeta = runtimeCommandMeta("doctor");
  ctx.program
    .command("doctor")
    .description(doctorMeta.summary)
    .action(() => {
      const output = ctx.globalOutputOpts();
      try {
        const report = getDoctorReport();
        printDoctorReport(report, output);
        process.exitCode = report.ok ? 0 : 1;
      } catch (error) {
        ctx.handleFailure(error, output);
      }
    });

  const contractMeta = runtimeCommandMeta("contract");
  ctx.program
    .command("contract")
    .description(contractMeta.summary)
    .action(() => {
      const output = ctx.globalOutputOpts();
      try {
        const report = getCliContractReport(ctx.readPackageVersion());
        printContractReport(report, output);
      } catch (error) {
        ctx.handleFailure(error, output);
      }
    });

  const openMeta = runtimeCommandMeta("open");
  ctx.program
    .command("open")
    .description(openMeta.summary)
    .argument("<url>", "Absolute URL to open")
    .option("--reuse-url", "Reuse existing tab for same URL if present", false)
    .option("--timeout-ms <ms>", "Navigation timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_OPEN_TIMEOUT_MS)
    .option("--fields <csv>", "Return only selected top-level fields")
    .action(async (url: string, options: { timeoutMs: number; reuseUrl?: boolean; fields?: string }) => {
      const output = ctx.globalOutputOpts();
      const globalOpts = ctx.program.opts<{ session?: string }>();
      try {
        const fields = parseFieldsCsv(options.fields);
        const report = await openUrl({
          inputUrl: url,
          timeoutMs: options.timeoutMs,
          reuseUrl: Boolean(options.reuseUrl),
          sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
        });
        printOpenSuccess(projectReportFields(report as unknown as Record<string, unknown>, fields), output);
      } catch (error) {
        ctx.handleFailure(error, output);
      }
    });

  const session = ctx.program.command("session").description("Manage reusable browser sessions");

  session
    .command("ensure")
    .description(runtimeCommandMeta("session.ensure").summary)
    .option("--timeout-ms <ms>", "Session readiness timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS)
    .action(async (options: { timeoutMs: number }) => {
      const output = ctx.globalOutputOpts();
      try {
        const report = await sessionEnsure({
          timeoutMs: options.timeoutMs,
        });
        printSessionSuccess(report, output);
      } catch (error) {
        ctx.handleFailure(error, output);
      }
    });

  session
    .command("new")
    .description(runtimeCommandMeta("session.new").summary)
    .option("--session-id <sessionId>", "Session id to assign (optional)")
    .option("--policy <policy>", "Session retention policy: ephemeral | persistent")
    .option("--lease-ttl-ms <ms>", "Session lease TTL in milliseconds", parseLeaseTtlMs)
    .option("--timeout-ms <ms>", "Session readiness timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS)
    .action(async (options: { sessionId?: string; policy?: string; leaseTtlMs?: number; timeoutMs: number }) => {
      const output = ctx.globalOutputOpts();
      try {
        const report = await sessionNew({
          timeoutMs: options.timeoutMs,
          requestedSessionId: options.sessionId,
          policyInput: options.policy,
          leaseTtlMs: options.leaseTtlMs,
        });
        printSessionSuccess(report, output);
      } catch (error) {
        ctx.handleFailure(error, output);
      }
    });

  session
    .command("attach")
    .description(runtimeCommandMeta("session.attach").summary)
    .requiredOption("--cdp <origin>", "CDP endpoint origin, e.g. http://127.0.0.1:9222")
    .option("--session-id <sessionId>", "Session id to assign (optional)")
    .option("--policy <policy>", "Session retention policy: ephemeral | persistent")
    .option("--lease-ttl-ms <ms>", "Session lease TTL in milliseconds", parseLeaseTtlMs)
    .option("--timeout-ms <ms>", "CDP reachability timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS)
    .action(async (options: { cdp: string; sessionId?: string; policy?: string; leaseTtlMs?: number; timeoutMs: number }) => {
      const output = ctx.globalOutputOpts();
      try {
        const report = await sessionAttach({
          requestedSessionId: options.sessionId,
          cdpOriginInput: options.cdp,
          timeoutMs: options.timeoutMs,
          policyInput: options.policy,
          leaseTtlMs: options.leaseTtlMs,
        });
        printSessionSuccess(report, output);
      } catch (error) {
        ctx.handleFailure(error, output);
      }
    });

  session
    .command("use")
    .description(runtimeCommandMeta("session.use").summary)
    .argument("<sessionId>", "Session to activate")
    .option("--timeout-ms <ms>", "Session readiness timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS)
    .action(async (sessionId: string, options: { timeoutMs: number }) => {
      const output = ctx.globalOutputOpts();
      try {
        const report = await sessionUse({
          timeoutMs: options.timeoutMs,
          sessionIdInput: sessionId,
        });
        printSessionSuccess(report, output);
      } catch (error) {
        ctx.handleFailure(error, output);
      }
    });

  session
    .command("list")
    .description(runtimeCommandMeta("session.list").summary)
    .action(() => {
      const output = ctx.globalOutputOpts();
      try {
        const report = sessionList();
        printSessionSuccess(report, output);
      } catch (error) {
        ctx.handleFailure(error, output);
      }
    });

  session
    .command("prune")
    .description(runtimeCommandMeta("session.prune").summary)
    .option("--drop-managed-unreachable", "Remove managed sessions when currently unreachable", false)
    .option("--timeout-ms <ms>", "Session reachability timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS)
    .action(async (options: { dropManagedUnreachable?: boolean; timeoutMs: number }) => {
      const output = ctx.globalOutputOpts();
      try {
        const report = await sessionPrune({
          timeoutMs: options.timeoutMs,
          dropManagedUnreachable: Boolean(options.dropManagedUnreachable),
        });
        printSessionSuccess(report, output);
      } catch (error) {
        ctx.handleFailure(error, output);
      }
    });

  ctx.program
    .command("state")
    .description("State maintenance operations")
    .command("reconcile")
    .description(runtimeCommandMeta("state.reconcile").summary)
    .option("--timeout-ms <ms>", "Session reachability timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS)
    .option("--max-age-hours <h>", "Maximum target age in hours to retain")
    .option("--max-per-session <n>", "Maximum retained targets per session")
    .option("--drop-managed-unreachable", "Remove managed sessions when currently unreachable", false)
    .action(
      async (options: {
        timeoutMs: number;
        maxAgeHours?: string;
        maxPerSession?: string;
        dropManagedUnreachable?: boolean;
      }) => {
        const output = ctx.globalOutputOpts();
        const maxAgeHours = typeof options.maxAgeHours === "string" ? Number.parseInt(options.maxAgeHours, 10) : undefined;
        const maxPerSession =
          typeof options.maxPerSession === "string" ? Number.parseInt(options.maxPerSession, 10) : undefined;
        try {
          const report = await stateReconcile({
            timeoutMs: options.timeoutMs,
            maxAgeHours,
            maxPerSession,
            dropManagedUnreachable: Boolean(options.dropManagedUnreachable),
          });
          printStateReconcileSuccess(report, output);
        } catch (error) {
          ctx.handleFailure(error, output);
        }
      },
    );

  ctx.program
    .command("run")
    .description(runtimeCommandMeta("run").summary)
    .requiredOption("--plan <path>", "Path to JSON plan file")
    .option("--timeout-ms <ms>", "Default step timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_OPEN_TIMEOUT_MS)
    .action(async (options: { plan: string; timeoutMs: number }) => {
      const output = ctx.globalOutputOpts();
      const globalOpts = ctx.program.opts<{ session?: string }>();
      try {
        const report = await runPipeline({
          planPath: options.plan,
          timeoutMs: options.timeoutMs,
          sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
        });
        printRunSuccess(report, output);
      } catch (error) {
        ctx.handleFailure(error, output);
      }
    });
}
