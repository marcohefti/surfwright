import { targetNetworkArtifactPrune } from "../../../core/network/public.js";
import { networkCommandMeta } from "../manifest.js";
import type { NetworkCommandSpec } from "./types.js";

const meta = networkCommandMeta("target.network-export-prune");

export const networkExportPruneCommandSpec: NetworkCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("network-export-prune")
      .description("Prune export artifact index/files by retention policy")
      .option("--max-age-hours <h>", "Delete artifacts older than N hours")
      .option("--max-count <n>", "Keep at most N newest artifacts")
      .option("--max-total-mb <n>", "Keep artifacts within total size budget (MB)")
      .option("--keep-files", "Only prune state index, do not delete files")
      .action(
        async (options: { maxAgeHours?: string; maxCount?: string; maxTotalMb?: string; keepFiles?: boolean }) => {
          const output = ctx.globalOutputOpts();
          try {
            const report = await targetNetworkArtifactPrune({
              maxAgeHours: typeof options.maxAgeHours === "string" ? Number.parseInt(options.maxAgeHours, 10) : undefined,
              maxCount: typeof options.maxCount === "string" ? Number.parseInt(options.maxCount, 10) : undefined,
              maxTotalBytes:
                typeof options.maxTotalMb === "string" ? Number.parseInt(options.maxTotalMb, 10) * 1024 * 1024 : undefined,
              deleteFiles: !options.keepFiles,
            });
            ctx.printTargetSuccess(report, output);
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};
