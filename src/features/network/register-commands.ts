import type { NetworkCommandContext } from "./commands/types.js";
import { networkCommandSpecs } from "./commands/index.js";

export function registerNetworkCommands(ctx: NetworkCommandContext) {
  for (const spec of networkCommandSpecs) {
    spec.register(ctx);
  }
}
