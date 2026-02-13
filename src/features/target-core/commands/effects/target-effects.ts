import { parseFieldsCsv, projectReportFields, targetScrollPlan, targetTransitionTrace } from "../../../../core/usecases.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../../core/types.js";
import { targetCommandMeta } from "../../manifest.js";
import type { TargetCommandSpec } from "../types.js";

const scrollPlanMeta = targetCommandMeta("target.scroll-plan");
const transitionTraceMeta = targetCommandMeta("target.transition-trace");

export const targetScrollPlanCommandSpec: TargetCommandSpec = {
  id: scrollPlanMeta.id,
  usage: scrollPlanMeta.usage,
  summary: scrollPlanMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("scroll-plan")
      .description(scrollPlanMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--steps <csv>", "Comma-separated requested scrollY positions", "0,300,600,900")
      .option("--settle-ms <ms>", "Settle delay after each scroll step in milliseconds", "300")
      .option("--timeout-ms <ms>", "Command timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state", false)
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(async (targetId: string, options: { steps: string; settleMs: string; timeoutMs: number; noPersist?: boolean; fields?: string }) => {
        const output = ctx.globalOutputOpts();
        const globalOpts = ctx.program.opts<{ session?: string }>();
        const fields = parseFieldsCsv(options.fields);
        try {
          const report = await targetScrollPlan({
            targetId,
            timeoutMs: options.timeoutMs,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
            stepsCsv: options.steps,
            settleMs: Number.parseInt(options.settleMs, 10),
            persistState: !Boolean(options.noPersist),
          });
          ctx.printTargetSuccess(projectReportFields(report as unknown as Record<string, unknown>, fields), output);
        } catch (error) {
          ctx.handleFailure(error, output);
        }
      });
  },
};

export const targetTransitionTraceCommandSpec: TargetCommandSpec = {
  id: transitionTraceMeta.id,
  usage: transitionTraceMeta.usage,
  summary: transitionTraceMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("transition-trace")
      .description(transitionTraceMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--capture-ms <ms>", "Capture window after optional click in milliseconds", "2500")
      .option("--max-events <n>", "Maximum transition/animation events to return", "120")
      .option("--click-text <query>", "Optional text query to click before capture")
      .option("--click-selector <query>", "Optional selector query to click before capture")
      .option("--contains <text>", "Optional contains filter when using --click-selector")
      .option("--visible-only", "Require click target to be visible", false)
      .option("--timeout-ms <ms>", "Command timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state", false)
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            captureMs: string;
            maxEvents: string;
            clickText?: string;
            clickSelector?: string;
            contains?: string;
            visibleOnly?: boolean;
            timeoutMs: number;
            noPersist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          try {
            const report = await targetTransitionTrace({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              captureMs: Number.parseInt(options.captureMs, 10),
              maxEvents: Number.parseInt(options.maxEvents, 10),
              clickText: options.clickText,
              clickSelector: options.clickSelector,
              containsQuery: options.contains,
              visibleOnly: Boolean(options.visibleOnly),
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
