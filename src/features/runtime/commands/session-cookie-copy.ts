import type { Command } from "commander";
import { sessionCookieCopy } from "../../../core/session/public.js";
import { DEFAULT_SESSION_TIMEOUT_MS, type CliCommandContract, type SessionCookieCopyReport } from "../../../core/types.js";

type OutputOpts = {
  json: boolean;
  pretty: boolean;
};

type RegisterSessionCookieCopyCommandContext = {
  session: Command;
  parseTimeoutMs: (input: string) => number;
  globalOutputOpts: () => OutputOpts;
  handleFailure: (error: unknown, outputOpts: OutputOpts) => void;
  commandMeta: CliCommandContract;
};

function collectRepeatedString(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function writeJson(value: unknown, opts: { pretty: boolean }) {
  process.stdout.write(`${JSON.stringify(value, null, opts.pretty ? 2 : 0)}\n`);
}

function printSessionCookieCopySuccess(report: SessionCookieCopyReport, opts: OutputOpts) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }
  process.stdout.write(
    [
      "ok",
      `fromSessionId=${report.fromSessionId}`,
      `toSessionId=${report.toSessionId}`,
      `found=${report.counts.found}`,
      `imported=${report.counts.imported}`,
      `urls=${report.urls.length}`,
    ].join(" ") + "\n",
  );
}

export function registerSessionCookieCopyCommand(ctx: RegisterSessionCookieCopyCommandContext): void {
  ctx.session
    .command("cookie-copy")
    .description(ctx.commandMeta.summary)
    .requiredOption("--from-session <sessionId>", "Source session to read cookies from")
    .requiredOption("--to-session <sessionId>", "Destination session to import cookies into")
    .requiredOption(
      "--url <url>",
      "Absolute URL scope to read cookies for (repeat for multi-domain auth)",
      collectRepeatedString,
      [],
    )
    .option("--timeout-ms <ms>", "Session reachability timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS)
    .action(
      async (options: {
        fromSession: string;
        toSession: string;
        url: string[];
        timeoutMs: number;
      }) => {
        const output = ctx.globalOutputOpts();
        try {
          const report = await sessionCookieCopy({
            fromSessionIdInput: options.fromSession,
            toSessionIdInput: options.toSession,
            urlInputs: options.url,
            timeoutMs: options.timeoutMs,
          });
          printSessionCookieCopySuccess(report, output);
        } catch (error) {
          ctx.handleFailure(error, output);
        }
      },
    );
}
