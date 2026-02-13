import { parseFieldsCsv, projectReportFields, targetEval } from "../../../core/usecases.js";
import { DEFAULT_TARGET_EVAL_MAX_CONSOLE, DEFAULT_TARGET_TIMEOUT_MS } from "../../../core/types.js";
import { targetCommandMeta } from "../manifest.js";
import type { TargetCommandSpec } from "./types.js";

const meta = targetCommandMeta("target.eval");

export const targetEvalCommandSpec: TargetCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("eval")
      .description(meta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--expression <js>", "JavaScript to run in page context")
      .option("--js <js>", "Alias for --expression")
      .option("--script <js>", "Alias for --expression")
      .option("--arg-json <json>", "JSON value passed as arg to the expression")
      .option("--capture-console", "Capture console output during evaluation", false)
      .option("--max-console <n>", "Maximum captured console entries", String(DEFAULT_TARGET_EVAL_MAX_CONSOLE))
      .option("--timeout-ms <ms>", "Evaluation timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state", false)
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            expression: string;
            js?: string;
            script?: string;
            argJson?: string;
            captureConsole?: boolean;
            maxConsole: string;
            timeoutMs: number;
            noPersist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const maxConsole = Number.parseInt(options.maxConsole, 10);
          const expression = [options.expression, options.js, options.script].find(
            (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
          );
          const fields = parseFieldsCsv(options.fields);

          try {
            const report = await targetEval({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              expression,
              argJson: options.argJson,
              captureConsole: Boolean(options.captureConsole),
              maxConsole,
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
