import { parseFieldsCsv, projectReportFields, targetSnapshot } from "../../../core/usecases.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../core/types.js";
import { targetCommandMeta } from "../manifest.js";
import type { TargetCommandSpec } from "./types.js";

const meta = targetCommandMeta("target.snapshot");

export const targetSnapshotCommandSpec: TargetCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("snapshot")
      .description(meta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--selector <query>", "Scope snapshot to a selector")
      .option("--visible-only", "Only include visible content")
      .option("--max-chars <n>", "Maximum text preview chars to return")
      .option("--max-headings <n>", "Maximum heading rows to return")
      .option("--max-buttons <n>", "Maximum button rows to return")
      .option("--max-links <n>", "Maximum link rows to return")
      .option("--timeout-ms <ms>", "Snapshot timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state", false)
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            selector?: string;
            visibleOnly?: boolean;
            maxChars?: string;
            maxHeadings?: string;
            maxButtons?: string;
            maxLinks?: string;
            timeoutMs: number;
            noPersist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          const maxChars = typeof options.maxChars === "string" ? Number.parseInt(options.maxChars, 10) : undefined;
          const maxHeadings =
            typeof options.maxHeadings === "string" ? Number.parseInt(options.maxHeadings, 10) : undefined;
          const maxButtons =
            typeof options.maxButtons === "string" ? Number.parseInt(options.maxButtons, 10) : undefined;
          const maxLinks = typeof options.maxLinks === "string" ? Number.parseInt(options.maxLinks, 10) : undefined;

          try {
            const report = await targetSnapshot({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              selectorQuery: options.selector,
              visibleOnly: Boolean(options.visibleOnly),
              maxChars,
              maxHeadings,
              maxButtons,
              maxLinks,
              persistState: !Boolean(options.noPersist),
            });
            ctx.printTargetSuccess(projectReportFields(report as unknown as Record<string, unknown>, fields), output);
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};
