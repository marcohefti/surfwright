import { targetSnapshotDiffFromFiles } from "../../../../core/target/public.js";
import { targetCommandMeta } from "../../manifest.js";
import type { TargetCommandSpec } from "../types.js";

const meta = targetCommandMeta("target.snapshot-diff");

export const targetSnapshotDiffCommandSpec: TargetCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("snapshot-diff")
      .description("Diff two saved target snapshot JSON reports with high-signal deltas")
      .argument("<a>", "Path to JSON output from `surfwright target snapshot` (before)")
      .argument("<b>", "Path to JSON output from `surfwright target snapshot` (after)")
      .action(async (aPath: string, bPath: string) => {
        const output = ctx.globalOutputOpts();
        try {
          const report = targetSnapshotDiffFromFiles({ aPath, bPath });
          ctx.printTargetSuccess(report, output);
        } catch (error) {
          ctx.handleFailure(error, output);
        }
      });
  },
};
