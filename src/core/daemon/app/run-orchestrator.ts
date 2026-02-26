import process from "node:process";
import { createInlineDaemonScheduler } from "../domain/index.js";
import { withCapturedRequestContext } from "../../request-context.js";
import { toCliFailure } from "../../errors.js";
import { parseOutputOptsFromArgv } from "../../../cli/commander-failure.js";

type DaemonRunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type RunLocalCommand = (argv: string[]) => Promise<number>;

export async function runDaemonCommandOrchestrator(opts: {
  argv: string[];
  runLocalCommand: RunLocalCommand;
}): Promise<DaemonRunResult> {
  const scheduler = createInlineDaemonScheduler<DaemonRunResult>();
  const output = parseOutputOptsFromArgv(opts.argv);
  const captured = await withCapturedRequestContext({
    initialExitCode: 0,
    run: async () =>
      await scheduler.enqueue({
        laneKey: "daemon.worker.run",
        execute: async () => {
          let code = 0;
          try {
            code = await opts.runLocalCommand(opts.argv);
          } catch (error) {
            const failure = toCliFailure(error);
            if (output.json) {
              process.stdout.write(`${JSON.stringify(failure, null, output.pretty ? 2 : 0)}\n`);
            } else {
              process.stderr.write(`error ${failure.code}: ${failure.message}\n`);
            }
            code = 1;
          }
          return {
            code,
            stdout: "",
            stderr: "",
          };
        },
      }),
  });
  return {
    code: captured.result.code,
    stdout: captured.stdout,
    stderr: captured.stderr,
  };
}
