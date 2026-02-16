import { parseFieldsCsv, projectReportFields, targetEval } from "../../../core/target/public.js";
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
      .option("--expr <js>", "JavaScript expression to evaluate and return (no explicit return required)")
      .option("--expression <js>", "JavaScript function body to run in page context (use return to yield a value)")
      .option("--js <js>", "Alias for --expression")
      .option("--script <js>", "Alias for --expression")
      .option("--script-file <path>", "Read JavaScript expression from file")
      .option("--arg-json <json>", "JSON value passed as arg to the expression")
      .option("--frame-id <id>", "Frame handle returned by target frames (default: f-0)")
      .option("--capture-console", "Capture console output during evaluation", false)
      .option("--max-console <n>", "Maximum captured console entries", String(DEFAULT_TARGET_EVAL_MAX_CONSOLE))
      .option("--timeout-ms <ms>", "Evaluation timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            expr?: string;
            expression: string;
            js?: string;
            script?: string;
            scriptFile?: string;
            argJson?: string;
            frameId?: string;
            captureConsole?: boolean;
            maxConsole: string;
            timeoutMs: number;
            persist?: boolean;
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
              expr: options.expr,
              expression,
              scriptFile: options.scriptFile,
              argJson: options.argJson,
              frameId: options.frameId,
              captureConsole: Boolean(options.captureConsole),
              maxConsole,
              persistState: options.persist !== false,
            });
            ctx.printTargetSuccess(projectReportFields(report as unknown as Record<string, unknown>, fields), output);
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};
