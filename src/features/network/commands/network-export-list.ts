import { targetNetworkArtifactList } from "../../../core/network/public.js";
import { networkCommandMeta } from "../manifest.js";
import type { NetworkCommandSpec } from "./types.js";

const meta = networkCommandMeta("target.network-export-list");

export const networkExportListCommandSpec: NetworkCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("network-export-list")
      .description("List indexed network export artifacts")
      .option("--limit <n>", "Maximum artifacts to return", "50")
      .action((options: { limit: string }) => {
        const output = ctx.globalOutputOpts();
        try {
          const report = targetNetworkArtifactList({
            limit: Number.parseInt(options.limit, 10),
          });
          ctx.printTargetSuccess(report, output);
        } catch (error) {
          ctx.handleFailure(error, output);
        }
      });
  },
};
