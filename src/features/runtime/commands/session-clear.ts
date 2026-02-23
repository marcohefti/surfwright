import type { Command } from "commander";
import { sessionClearAll } from "../../../core/session/public.js";
import { DEFAULT_SESSION_TIMEOUT_MS, type CliCommandContract } from "../../../core/types.js";
type SessionClearReport = Awaited<ReturnType<typeof sessionClearAll>>;

type OutputOpts = {
  json: boolean;
  pretty: boolean;
};

type RegisterSessionClearCommandContext = {
  session: Command;
  parseTimeoutMs: (input: string) => number;
  globalOutputOpts: () => OutputOpts;
  handleFailure: (error: unknown, outputOpts: OutputOpts) => void;
  commandMeta: CliCommandContract;
};

function writeJson(value: unknown, opts: { pretty: boolean }) {
  process.stdout.write(`${JSON.stringify(value, null, opts.pretty ? 2 : 0)}\n`);
}

function printSessionClearSuccess(report: SessionClearReport, opts: OutputOpts) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }
  process.stdout.write(
    [
      "ok",
      `scope=${report.scope}`,
      `requestedSessionId=${report.requestedSessionId ?? "none"}`,
      `activeSessionId=${report.activeSessionId ?? "none"}`,
      `scanned=${report.scanned}`,
      `cleared=${report.cleared}`,
      `shutdownRequested=${report.processShutdown.requested}`,
      `shutdownFailed=${report.processShutdown.failed}`,
    ].join(" ") + "\n",
  );
}

export function registerSessionClearCommand(ctx: RegisterSessionClearCommandContext): void {
  ctx.session
    .command("clear")
    .description(ctx.commandMeta.summary)
    .option("--keep-processes", "Clear session state but keep browser processes running", false)
    .option("--timeout-ms <ms>", "Session/process shutdown timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS)
    .action(async (options: { keepProcesses?: boolean; timeoutMs: number }, command: Command) => {
      const output = ctx.globalOutputOpts();
      const globals = command.optsWithGlobals<{ session?: unknown }>();
      const scopedSessionId = typeof globals.session === "string" && globals.session.trim().length > 0 ? globals.session : undefined;
      try {
        const report = await sessionClearAll({
          timeoutMs: options.timeoutMs,
          keepProcesses: Boolean(options.keepProcesses),
          sessionId: scopedSessionId,
        });
        printSessionClearSuccess(report, output);
      } catch (error) {
        ctx.handleFailure(error, output);
      }
    });
}
