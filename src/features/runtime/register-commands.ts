import fs from "node:fs";
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
} from "../../core/types.js";
import { getCliContractReport } from "../../core/cli-contract.js";
import { runtimeCommandMeta } from "./manifest.js";
import { registerSkillLifecycleCommands } from "./commands/skill-lifecycle.js";
import { registerSessionCookieCopyCommand } from "./commands/session-cookie-copy.js";
import { registerSessionClearCommand } from "./commands/session-clear.js";
import { registerUpdateLifecycleCommands } from "./commands/update-lifecycle.js";
import {
  printContractReport,
  printDoctorReport,
  printOpenSuccess,
  printRunSuccess,
  printSessionSuccess,
  printStateReconcileSuccess,
  type RuntimeOutputOpts,
} from "./printers.js";

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
    .option("--browser-mode <mode>", "Browser launch mode for managed sessions: headless | headed")
    .option("--isolation <mode>", "Session mode when --session is omitted: isolated|shared", "isolated")
    .option("--timeout-ms <ms>", "Navigation timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_OPEN_TIMEOUT_MS)
    .option("--fields <csv>", "Return only selected top-level fields")
    .action(
      async (
        url: string,
        options: { timeoutMs: number; reuseUrl?: boolean; browserMode?: string; isolation?: string; fields?: string },
      ) => {
      const output = ctx.globalOutputOpts();
      const globalOpts = ctx.program.opts<{ session?: string }>();
      try {
        const fields = parseFieldsCsv(options.fields);
        const report = await openUrl({
          inputUrl: url,
          timeoutMs: options.timeoutMs,
          reuseUrl: Boolean(options.reuseUrl),
          browserModeInput: options.browserMode,
          isolation: options.isolation,
          sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
        });
        printOpenSuccess(projectReportFields(report as unknown as Record<string, unknown>, fields), output);
      } catch (error) {
        ctx.handleFailure(error, output);
      }
      },
    );

  const session = ctx.program.command("session").description("Manage reusable browser sessions");

  session
    .command("ensure")
    .description(runtimeCommandMeta("session.ensure").summary)
    .option("--browser-mode <mode>", "Browser launch mode for managed sessions: headless | headed")
    .option("--timeout-ms <ms>", "Session readiness timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS)
    .action(async (options: { timeoutMs: number; browserMode?: string }) => {
      const output = ctx.globalOutputOpts();
      try {
        const report = await sessionEnsure({
          timeoutMs: options.timeoutMs,
          browserModeInput: options.browserMode,
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
    .option("--browser-mode <mode>", "Browser launch mode for managed sessions: headless | headed")
    .option("--policy <policy>", "Session retention policy: ephemeral | persistent")
    .option("--lease-ttl-ms <ms>", "Session lease TTL in milliseconds", parseLeaseTtlMs)
    .option("--timeout-ms <ms>", "Session readiness timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS)
    .action(
      async (options: { sessionId?: string; browserMode?: string; policy?: string; leaseTtlMs?: number; timeoutMs: number }) => {
      const output = ctx.globalOutputOpts();
      try {
        const report = await sessionNew({
          timeoutMs: options.timeoutMs,
          requestedSessionId: options.sessionId,
          browserModeInput: options.browserMode,
          policyInput: options.policy,
          leaseTtlMs: options.leaseTtlMs,
        });
        printSessionSuccess(report, output);
      } catch (error) {
        ctx.handleFailure(error, output);
      }
      },
    );

  session
    .command("fresh")
    .description(runtimeCommandMeta("session.fresh").summary)
    .option("--session-id <sessionId>", "Session id to assign (optional)")
    .option("--browser-mode <mode>", "Browser launch mode for managed sessions: headless | headed")
    .option("--lease-ttl-ms <ms>", "Session lease TTL in milliseconds", parseLeaseTtlMs)
    .option("--timeout-ms <ms>", "Session readiness timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS)
    .action(async (options: { sessionId?: string; browserMode?: string; leaseTtlMs?: number; timeoutMs: number }) => {
      const output = ctx.globalOutputOpts();
      try {
        const report = await sessionNew({
          timeoutMs: options.timeoutMs,
          requestedSessionId: options.sessionId,
          browserModeInput: options.browserMode,
          policyInput: "ephemeral",
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
  registerSessionClearCommand({
    session,
    parseTimeoutMs: ctx.parseTimeoutMs,
    globalOutputOpts: ctx.globalOutputOpts,
    handleFailure: ctx.handleFailure,
    commandMeta: runtimeCommandMeta("session.clear"),
  });
  registerSessionCookieCopyCommand({
    session,
    parseTimeoutMs: ctx.parseTimeoutMs,
    globalOutputOpts: ctx.globalOutputOpts,
    handleFailure: ctx.handleFailure,
    commandMeta: runtimeCommandMeta("session.cookie-copy"),
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
    .option("--plan <path>", "Path to JSON plan file (use - for stdin)")
    .option("--plan-json <json>", "Inline JSON plan payload")
    .option("--replay <path>", "Replay a previously recorded run artifact")
    .option("--doctor", "Lint plan source and return issues without executing", false)
    .option("--record", "Write run artifact with timeline and replay payload", false)
    .option("--record-path <path>", "Explicit output path for recorded artifact")
    .option("--record-label <label>", "Label to include in recorded artifact metadata")
    .option("--browser-mode <mode>", "Browser launch mode for managed sessions: headless | headed")
    .option("--isolation <mode>", "Session mode when --session is omitted: isolated|shared", "isolated")
    .option("--timeout-ms <ms>", "Default step timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_OPEN_TIMEOUT_MS)
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  surfwright --json run --doctor --plan-json '{\"steps\":[{\"id\":\"open\",\"url\":\"https://example.com\"},{\"id\":\"snapshot\"}]}'",
        "  surfwright --json run --plan ./plan.json --record --record-label smoke",
        "  surfwright --json run --replay ~/.surfwright/runs/<artifact>.json",
      ].join("\n"),
    )
    .action(
      async (options: {
        plan?: string;
        planJson?: string;
        replay?: string;
        doctor?: boolean;
        record?: boolean;
        recordPath?: string;
        recordLabel?: string;
        browserMode?: string;
        isolation?: string;
        timeoutMs: number;
      }) => {
      const output = ctx.globalOutputOpts();
      const globalOpts = ctx.program.opts<{ session?: string }>();
      try {
        const stdinPlan = options.plan === "-" ? fs.readFileSync(0, "utf8") : undefined;
        const report = await runPipeline({
          planPath: options.plan,
          planJson: options.planJson,
          stdinPlan,
          replayPath: options.replay,
          timeoutMs: options.timeoutMs,
          browserModeInput: options.browserMode,
          isolation: options.isolation,
          doctor: Boolean(options.doctor),
          record: Boolean(options.record),
          recordPath: options.recordPath,
          recordLabel: options.recordLabel,
          sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
        });
        printRunSuccess(report, output);
        if (report.mode === "doctor" && report.valid !== true) {
          process.exitCode = 1;
        }
      } catch (error) {
        ctx.handleFailure(error, output);
      }
      },
    );
  registerUpdateLifecycleCommands({
    program: ctx.program,
    globalOutputOpts: ctx.globalOutputOpts,
    handleFailure: ctx.handleFailure,
    readPackageVersion: ctx.readPackageVersion,
  });

  registerSkillLifecycleCommands({
    program: ctx.program,
    globalOutputOpts: ctx.globalOutputOpts,
    handleFailure: ctx.handleFailure,
    readPackageVersion: ctx.readPackageVersion,
  });
}
