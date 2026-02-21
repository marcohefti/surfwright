import { parseFieldsCsv, projectReportFields, targetCount } from "../../../../core/target/public.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../../core/types.js";
import { targetCommandMeta } from "../../manifest.js";
import type { TargetCommandSpec } from "../types.js";

const meta = targetCommandMeta("target.count");

export const targetCountCommandSpec: TargetCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("count")
      .description(meta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--text <query>", "Text query for fuzzy text match")
      .option("--selector <query>", "CSS selector query")
      .option("--contains <text>", "Text filter to apply with --selector")
      .option("--visible-only", "Only count visible matches")
      .option("--frame-scope <scope>", "Frame scope: main|all", "main")
      .option("--count-only", "Return only {ok,count} compact output", false)
      .option("--timeout-ms <ms>", "Count timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .addHelpText(
        "after",
        [
          "",
          "Examples:",
          "  surfwright target count <targetId> --selector '.row' --visible-only",
          "  surfwright target count <targetId> --selector '.row' --count-only",
        ].join("\n"),
      )
      .action(
        async (
          targetId: string,
          options: {
            text?: string;
            selector?: string;
            contains?: string;
            visibleOnly?: boolean;
            frameScope?: string;
            countOnly?: boolean;
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);

          try {
            const report = await targetCount({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              textQuery: options.text,
              selectorQuery: options.selector,
              containsQuery: options.contains,
              visibleOnly: Boolean(options.visibleOnly),
              frameScope: options.frameScope,
              persistState: options.persist !== false,
            });
            const projected = options.countOnly
              ? { ok: report.ok, count: report.count }
              : projectReportFields(report as unknown as Record<string, unknown>, fields);
            ctx.printTargetSuccess(projected, output);
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};
