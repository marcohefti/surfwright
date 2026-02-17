import { runPipeline as runPipelineInternal } from "./app/run.js";
import { sessionEnsure } from "../session/public.js";

export async function runPipeline(opts: {
  planPath?: string;
  planJson?: string;
  stdinPlan?: string;
  replayPath?: string;
  timeoutMs: number;
  sessionId?: string;
  profile?: string;
  browserModeInput?: string;
  isolation?: string;
  doctor?: boolean;
  record?: boolean;
  recordPath?: string;
  recordLabel?: string;
  logNdjsonPath?: string;
  logNdjsonMode?: string;
}): Promise<Record<string, unknown>> {
  return await runPipelineInternal({
    ...opts,
    ensureSharedSession: async ({ timeoutMs }) =>
      await sessionEnsure({
        timeoutMs,
        browserModeInput: opts.browserModeInput,
      }),
  });
}
