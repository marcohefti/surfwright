import { parseFieldsCsv, projectReportFields, targetRead } from "../../../core/usecases.js";
import { DEFAULT_TARGET_READ_CHUNK_SIZE, DEFAULT_TARGET_TIMEOUT_MS } from "../../../core/types.js";
import { targetCommandMeta } from "../manifest.js";
import type { TargetCommandSpec } from "./types.js";

const meta = targetCommandMeta("target.read");

export const targetReadCommandSpec: TargetCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("read")
      .description(meta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--selector <query>", "Scope read to a selector")
      .option("--visible-only", "Only include visible text")
      .option("--frame-scope <scope>", "Frame scope: main|all", "main")
      .option("--chunk-size <n>", "Chunk size in characters", String(DEFAULT_TARGET_READ_CHUNK_SIZE))
      .option("--chunk <n>", "Chunk index to read (1-based)", "1")
      .option("--timeout-ms <ms>", "Read timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state", false)
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            selector?: string;
            visibleOnly?: boolean;
            frameScope?: string;
            chunkSize: string;
            chunk: string;
            timeoutMs: number;
            noPersist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const chunkSize = Number.parseInt(options.chunkSize, 10);
          const chunkIndex = Number.parseInt(options.chunk, 10);
          const fields = parseFieldsCsv(options.fields);

          try {
            const report = await targetRead({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              selectorQuery: options.selector,
              visibleOnly: Boolean(options.visibleOnly),
              frameScope: options.frameScope,
              chunkSize,
              chunkIndex,
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
