import { ensureTargetCommand, printTargetSuccess } from "../target-core/index.js";
import type { NetworkCommandContext } from "./commands/types.js";
import { networkCommandSpecs } from "./commands/index.js";

type RegisterNetworkCommandsOptions = {
  program: NetworkCommandContext["program"];
  parseTimeoutMs: NetworkCommandContext["parseTimeoutMs"];
  globalOutputOpts: NetworkCommandContext["globalOutputOpts"];
  handleFailure: NetworkCommandContext["handleFailure"];
};

export function registerNetworkCommands(opts: RegisterNetworkCommandsOptions) {
  const ctx: NetworkCommandContext = {
    ...opts,
    target: ensureTargetCommand(opts.program),
    printTargetSuccess,
  };
  for (const spec of networkCommandSpecs) {
    spec.register(ctx);
  }
}
