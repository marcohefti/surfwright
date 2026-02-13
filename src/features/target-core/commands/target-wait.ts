import { targetWait } from "../../../core/usecases.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../core/types.js";
import { targetCommandMeta } from "../manifest.js";
import type { TargetCommandSpec } from "./types.js";

const meta = targetCommandMeta("target.wait");

export const targetWaitCommandSpec: TargetCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("wait")
      .description(meta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--for-text <text>", "Wait until text becomes visible")
      .option("--for-selector <query>", "Wait until selector becomes visible")
      .option("--network-idle", "Wait for network idle state")
      .option("--timeout-ms <ms>", "Wait timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .action(
        async (
          targetId: string,
          options: { forText?: string; forSelector?: string; networkIdle?: boolean; timeoutMs: number },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          try {
            const report = await targetWait({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              forText: options.forText,
              forSelector: options.forSelector,
              networkIdle: Boolean(options.networkIdle),
            });
            ctx.printTargetSuccess(report, output);
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};
