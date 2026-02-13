#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerTargetCommands } from "./cli-target.js";
import { toCliFailure } from "./core/errors.js";
import { parseWorkerArgv, runTargetNetworkWorker } from "./core/target-network-capture.js";
import {
  getCliContractReport,
  getDoctorReport,
  openUrl,
  sessionAttach,
  sessionEnsure,
  sessionList,
  sessionNew,
  sessionPrune,
  sessionUse,
  stateReconcile,
} from "./core/usecases.js";
import {
  DEFAULT_OPEN_TIMEOUT_MS,
  DEFAULT_SESSION_TIMEOUT_MS,
  type CliFailure,
  type CliContractReport,
  type DoctorReport,
  type OpenReport,
  type SessionListReport,
  type SessionPruneReport,
  type SessionReport,
  type StateReconcileReport,
} from "./core/types.js";

type OutputOpts = {
  json: boolean;
  pretty: boolean;
};

function resolveRepoRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "..");
}

function readPackageVersion(): string {
  try {
    const pkgPath = path.join(resolveRepoRoot(), "package.json");
    const raw = fs.readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function jsonSpacing(pretty: boolean): number {
  return pretty ? 2 : 0;
}

function writeJson(value: unknown, opts: { pretty: boolean }) {
  process.stdout.write(`${JSON.stringify(value, null, jsonSpacing(opts.pretty))}\n`);
}

function printDoctorReport(report: DoctorReport, opts: OutputOpts) {
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

function printContractReport(report: CliContractReport, opts: OutputOpts) {
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

function printFailure(failure: CliFailure, opts: OutputOpts) {
  if (opts.json) {
    writeJson(failure, { pretty: opts.pretty });
    return;
  }
  process.stdout.write(`error ${failure.code}: ${failure.message}\n`);
}

function printOpenSuccess(report: OpenReport, opts: OutputOpts) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }

  process.stdout.write(
    [
      "ok",
      `sessionId=${report.sessionId}`,
      `targetId=${report.targetId}`,
      `status=${report.status ?? "null"}`,
      `url=${report.url}`,
    ].join(" ") + "\n",
  );
}

function printSessionSuccess(report: SessionReport | SessionListReport | SessionPruneReport, opts: OutputOpts) {
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

function printStateReconcileSuccess(report: StateReconcileReport, opts: OutputOpts) {
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

function parseTimeoutMs(input: string): number {
  const value = Number.parseInt(input, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("timeout-ms must be a positive integer");
  }
  return value;
}

function normalizeArgv(argv: string[]): string[] {
  const out = [...argv];
  if (out[2] === "--") {
    out.splice(2, 1);
  }
  return out;
}

async function maybeRunInternalWorker(): Promise<boolean> {
  if (process.argv[2] !== "__network-worker") {
    return false;
  }
  try {
    const workerOpts = parseWorkerArgv(process.argv.slice(3));
    await runTargetNetworkWorker(workerOpts);
    process.exitCode = 0;
  } catch {
    process.exitCode = 1;
  }
  return true;
}

const program = new Command();

function globalOutputOpts(): OutputOpts {
  const globalOpts = program.opts<{ json?: boolean; pretty?: boolean }>();
  return {
    json: Boolean(globalOpts.json),
    pretty: Boolean(globalOpts.pretty),
  };
}

function handleFailure(error: unknown, opts: OutputOpts) {
  printFailure(toCliFailure(error), opts);
  process.exitCode = 1;
}

program
  .name("surfwright")
  .description(
    [
      "Agent-first browser control surface for Chrome/Chromium.",
      "Low-noise, composable commands. Deterministic output. JSON-first ergonomics.",
    ].join(" "),
  )
  .version(readPackageVersion(), "-v, --version")
  .option("--json", "Machine-readable output (where supported)", false)
  .option("--pretty", "Pretty-print JSON output", false)
  .option("--session <sessionId>", "Use a specific session for this command");

program
  .command("doctor")
  .description("Check local prerequisites (fast, no side effects)")
  .action(() => {
    const opts = globalOutputOpts();
    try {
      const report = getDoctorReport();
      printDoctorReport(report, opts);
      process.exitCode = report.ok ? 0 : 1;
    } catch (error) {
      handleFailure(error, opts);
    }
  });

program
  .command("contract")
  .description("Print machine-readable command and error contract")
  .action(() => {
    const opts = globalOutputOpts();
    try {
      const report = getCliContractReport(readPackageVersion());
      printContractReport(report, opts);
    } catch (error) {
      handleFailure(error, opts);
    }
  });

program
  .command("open")
  .description("Open a URL in Chrome and return a minimal page report")
  .argument("<url>", "Absolute URL to open")
  .option("--reuse-url", "Reuse existing tab for same URL if present", false)
  .option("--timeout-ms <ms>", "Navigation timeout in milliseconds", parseTimeoutMs, DEFAULT_OPEN_TIMEOUT_MS)
  .action(async (url: string, options: { timeoutMs: number; reuseUrl?: boolean }) => {
    const opts = globalOutputOpts();
    const globalOpts = program.opts<{ session?: string }>();

    try {
      const report = await openUrl({
        inputUrl: url,
        timeoutMs: options.timeoutMs,
        reuseUrl: Boolean(options.reuseUrl),
        sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
      });
      printOpenSuccess(report, opts);
    } catch (error) {
      handleFailure(error, opts);
    }
  });

const session = program.command("session").description("Manage reusable browser sessions");

session
  .command("ensure")
  .description("Use active session if reachable; otherwise create/use managed default session")
  .option("--timeout-ms <ms>", "Session readiness timeout in milliseconds", parseTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS)
  .action(async (options: { timeoutMs: number }) => {
    const opts = globalOutputOpts();
    try {
      const report = await sessionEnsure({
        timeoutMs: options.timeoutMs,
      });
      printSessionSuccess(report, opts);
    } catch (error) {
      handleFailure(error, opts);
    }
  });

session
  .command("new")
  .description("Spawn a fresh managed Chrome session and mark it active")
  .option("--session-id <sessionId>", "Session id to assign (optional)")
  .option("--timeout-ms <ms>", "Session readiness timeout in milliseconds", parseTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS)
  .action(async (options: { sessionId?: string; timeoutMs: number }) => {
    const opts = globalOutputOpts();
    try {
      const report = await sessionNew({
        timeoutMs: options.timeoutMs,
        requestedSessionId: options.sessionId,
      });
      printSessionSuccess(report, opts);
    } catch (error) {
      handleFailure(error, opts);
    }
  });

session
  .command("attach")
  .description("Explicitly attach a session to an already-running CDP endpoint")
  .requiredOption("--cdp <origin>", "CDP endpoint origin, e.g. http://127.0.0.1:9222")
  .option("--session-id <sessionId>", "Session id to assign (optional)")
  .action(async (options: { cdp: string; sessionId?: string }) => {
    const opts = globalOutputOpts();
    try {
      const report = await sessionAttach({
        requestedSessionId: options.sessionId,
        cdpOriginInput: options.cdp,
      });
      printSessionSuccess(report, opts);
    } catch (error) {
      handleFailure(error, opts);
    }
  });

session
  .command("use")
  .description("Switch active session")
  .argument("<sessionId>", "Session to activate")
  .option("--timeout-ms <ms>", "Session readiness timeout in milliseconds", parseTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS)
  .action(async (sessionId: string, options: { timeoutMs: number }) => {
    const opts = globalOutputOpts();
    try {
      const report = await sessionUse({
        timeoutMs: options.timeoutMs,
        sessionIdInput: sessionId,
      });
      printSessionSuccess(report, opts);
    } catch (error) {
      handleFailure(error, opts);
    }
  });

session
  .command("list")
  .description("List known sessions and active pointer")
  .action(() => {
    const opts = globalOutputOpts();
    try {
      const report = sessionList();
      printSessionSuccess(report, opts);
    } catch (error) {
      handleFailure(error, opts);
    }
  });

session
  .command("prune")
  .description("Prune unreachable sessions and repair stale managed pid metadata")
  .option("--drop-managed-unreachable", "Remove managed sessions when currently unreachable", false)
  .option("--timeout-ms <ms>", "Session reachability timeout in milliseconds", parseTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS)
  .action(async (options: { dropManagedUnreachable?: boolean; timeoutMs: number }) => {
    const opts = globalOutputOpts();
    try {
      const report = await sessionPrune({
        timeoutMs: options.timeoutMs,
        dropManagedUnreachable: Boolean(options.dropManagedUnreachable),
      });
      printSessionSuccess(report, opts);
    } catch (error) {
      handleFailure(error, opts);
    }
  });

program
  .command("state")
  .description("State maintenance operations")
  .command("reconcile")
  .description("Reconcile state by pruning stale sessions and target metadata")
  .option("--timeout-ms <ms>", "Session reachability timeout in milliseconds", parseTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS)
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
      const opts = globalOutputOpts();
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
        printStateReconcileSuccess(report, opts);
      } catch (error) {
        handleFailure(error, opts);
      }
    },
  );

const ranWorker = await maybeRunInternalWorker();
if (!ranWorker) {
  registerTargetCommands({
    program,
    parseTimeoutMs,
    globalOutputOpts,
    handleFailure,
  });

  program.parse(normalizeArgv(process.argv));
}
