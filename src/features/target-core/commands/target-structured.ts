import { parseFieldsCsv, projectReportFields, targetExtract } from "../../../core/usecases.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../core/types.js";
import { targetCommandMeta } from "../manifest.js";
import type { TargetCommandSpec } from "./types.js";

const extractMeta = targetCommandMeta("target.extract");

export const targetExtractCommandSpec: TargetCommandSpec = {
  id: extractMeta.id,
  usage: extractMeta.usage,
  summary: extractMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("extract")
      .description(extractMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--kind <kind>", "Extraction profile: generic|blog|news|docs")
      .option("--selector <query>", "Scope extraction to a selector")
      .option("--visible-only", "Only include visible content")
      .option("--frame-scope <scope>", "Frame scope: main|all")
      .option("--limit <n>", "Maximum extracted items to return")
      .option("--timeout-ms <ms>", "Extraction timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state", false)
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            kind?: string;
            selector?: string;
            visibleOnly?: boolean;
            frameScope?: string;
            limit?: string;
            timeoutMs: number;
            noPersist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          const limit = typeof options.limit === "string" ? Number.parseInt(options.limit, 10) : undefined;
          try {
            const report = await targetExtract({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              kind: options.kind,
              selectorQuery: options.selector,
              visibleOnly: Boolean(options.visibleOnly),
              frameScope: options.frameScope,
              limit,
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
