import { parseFieldsCsv, projectReportFields, targetList } from "../../../core/usecases.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../core/types.js";
import { targetCommandMeta } from "../manifest.js";
import type { TargetCommandSpec } from "./types.js";

const meta = targetCommandMeta("target.list");

export const targetListCommandSpec: TargetCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("list")
      .description(meta.summary)
      .option("--timeout-ms <ms>", "Target listing timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state", false)
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(async (options: { timeoutMs: number; noPersist?: boolean; fields?: string }) => {
        const output = ctx.globalOutputOpts();
        const globalOpts = ctx.program.opts<{ session?: string }>();
        try {
          const fields = parseFieldsCsv(options.fields);
          const report = await targetList({
            timeoutMs: options.timeoutMs,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
            persistState: !Boolean(options.noPersist),
          });
          ctx.printTargetSuccess(projectReportFields(report as unknown as Record<string, unknown>, fields), output);
        } catch (error) {
          ctx.handleFailure(error, output);
        }
      });
  },
};
