import { createInlineDaemonScheduler } from "../domain/index.js";
import { withCapturedRequestContext } from "../../request-context.js";
import { toCliFailure } from "../../errors.js";
import type { CliFailure } from "../../types.js";

type DaemonRunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type RunLocalCommand = (argv: string[]) => Promise<number>;
const DAEMON_CAPTURE_MAX_BYTES = 512 * 1024;

export async function runDaemonCommandOrchestrator(opts: {
  argv: string[];
  runLocalCommand: RunLocalCommand;
  emitFailure: (failure: CliFailure) => void;
}): Promise<DaemonRunResult> {
  const scheduler = createInlineDaemonScheduler<DaemonRunResult>();
  const captured = await withCapturedRequestContext({
    initialExitCode: 0,
    maxCapturedOutputBytes: DAEMON_CAPTURE_MAX_BYTES,
    run: async () =>
      await scheduler.enqueue({
        laneKey: "daemon.worker.run",
        execute: async () => {
          let code = 0;
          try {
            code = await opts.runLocalCommand(opts.argv);
          } catch (error) {
            opts.emitFailure(toCliFailure(error));
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
