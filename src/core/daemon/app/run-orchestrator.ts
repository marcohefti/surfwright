import { createInlineDaemonScheduler } from "../domain/index.js";
import { withCapturedRequestContext } from "../../request-context.js";

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
  const captured = await withCapturedRequestContext({
    initialExitCode: 0,
    run: async () =>
      await scheduler.enqueue({
        laneKey: "daemon.worker.run",
        execute: async () => {
          const code = await opts.runLocalCommand(opts.argv);
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
