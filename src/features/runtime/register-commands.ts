import { type Command } from "commander";
import {
  getDoctorReport,
  openUrl,
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
  type OpenReport,
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

function printOpenSuccess(report: OpenReport, opts: RuntimeOutputOpts) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }
  process.stdout.write(
    [
      "ok",
      `sessionId=${report.sessionId}`,
      `targetId=${report.targetId}`,
      `actionId=${report.actionId}`,
      `status=${report.status ?? "null"}`,
      `url=${report.url}`,
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
    .action(async (url: string, options: { timeoutMs: number; reuseUrl?: boolean }) => {
      const output = ctx.globalOutputOpts();
      const globalOpts = ctx.program.opts<{ session?: string }>();
      try {
        const report = await openUrl({
          inputUrl: url,
          timeoutMs: options.timeoutMs,
          reuseUrl: Boolean(options.reuseUrl),
          sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
        });
        printOpenSuccess(report, output);
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
    .option("--timeout-ms <ms>", "Session readiness timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS)
    .action(async (options: { sessionId?: string; timeoutMs: number }) => {
      const output = ctx.globalOutputOpts();
      try {
        const report = await sessionNew({
          timeoutMs: options.timeoutMs,
          requestedSessionId: options.sessionId,
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
    .action(async (options: { cdp: string; sessionId?: string }) => {
      const output = ctx.globalOutputOpts();
      try {
        const report = await sessionAttach({
          requestedSessionId: options.sessionId,
          cdpOriginInput: options.cdp,
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
}
