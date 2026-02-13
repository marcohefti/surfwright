import { registerNetworkCommands } from "../network/index.js";
import { targetCommandSpecs } from "./commands/index.js";
import type { TargetCommandContext, TargetOutputOpts } from "./commands/types.js";
import { printTargetSuccess } from "./formatters/index.js";

type RegisterTargetCommandsOptions = {
  program: TargetCommandContext["program"];
  parseTimeoutMs: TargetCommandContext["parseTimeoutMs"];
  globalOutputOpts: TargetCommandContext["globalOutputOpts"];
  handleFailure: (error: unknown, outputOpts: TargetOutputOpts) => void;
};

export function registerTargetCommands(opts: RegisterTargetCommandsOptions) {
  const target = opts.program.command("target").description("Inspect browser targets in a session");
  const targetCtx: TargetCommandContext = {
    ...opts,
    target,
    printTargetSuccess,
  };

  for (const spec of targetCommandSpecs) {
    spec.register(targetCtx);
  }

  registerNetworkCommands({
    ...targetCtx,
    printTargetSuccess: (report, output) => {
      printTargetSuccess(report, output);
    },
  });
}
