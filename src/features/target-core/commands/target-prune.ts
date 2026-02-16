import { targetPrune } from "../../../core/target/public.js";
import { targetCommandMeta } from "../manifest.js";
import type { TargetCommandSpec } from "./types.js";

const meta = targetCommandMeta("target.prune");

export const targetPruneCommandSpec: TargetCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("prune")
      .description(meta.summary)
      .option("--max-age-hours <h>", "Maximum target age in hours to retain")
      .option("--max-per-session <n>", "Maximum retained targets per session")
      .action(async (options: { maxAgeHours?: string; maxPerSession?: string }) => {
        const output = ctx.globalOutputOpts();
        const maxAgeHours = typeof options.maxAgeHours === "string" ? Number.parseInt(options.maxAgeHours, 10) : undefined;
        const maxPerSession =
          typeof options.maxPerSession === "string" ? Number.parseInt(options.maxPerSession, 10) : undefined;
        try {
          const report = await targetPrune({
            maxAgeHours,
            maxPerSession,
          });
          ctx.printTargetSuccess(report, output);
        } catch (error) {
          ctx.handleFailure(error, output);
        }
      });
  },
};
