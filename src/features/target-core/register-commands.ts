import { targetCommandSpecs } from "./commands/index.js";
import { ensureTargetCommand } from "./target-command.js";
import type { TargetCommandContext, TargetOutputOpts } from "./commands/types.js";
import { printTargetSuccess } from "./formatters/index.js";

type RegisterTargetCommandsOptions = {
  program: TargetCommandContext["program"];
  parseTimeoutMs: TargetCommandContext["parseTimeoutMs"];
  globalOutputOpts: TargetCommandContext["globalOutputOpts"];
  handleFailure: (error: unknown, outputOpts: TargetOutputOpts) => void;
};

export function registerTargetCommands(opts: RegisterTargetCommandsOptions) {
  const target = ensureTargetCommand(opts.program);
  const targetCtx: TargetCommandContext = {
    ...opts,
    target,
    printTargetSuccess,
  };

  for (const spec of targetCommandSpecs) {
    spec.register(targetCtx);
  }
}
