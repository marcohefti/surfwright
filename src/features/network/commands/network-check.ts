import { targetNetworkCheck } from "../../../core/usecases.js";
import { DEFAULT_TARGET_NETWORK_CAPTURE_MS, DEFAULT_TARGET_TIMEOUT_MS } from "../../../core/types.js";
import { networkCommandMeta } from "../manifest.js";
import type { NetworkCommandSpec } from "./types.js";

const meta = networkCommandMeta("target.network-check");

export const networkCheckCommandSpec: NetworkCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("network-check")
      .description("Evaluate network metrics against a budget file")
      .argument("[targetId]", "Target handle for live capture mode")
      .requiredOption("--budget <path>", "Budget JSON file")
      .option("--capture-id <id>", "Check against saved capture id")
      .option("--artifact-id <id>", "Check against saved artifact id")
      .option("--profile <preset>", "Live capture profile: custom|api|page|ws|perf", "perf")
      .option("--capture-ms <ms>", "Live capture duration in milliseconds", String(DEFAULT_TARGET_NETWORK_CAPTURE_MS))
      .option("--fail-on-violation", "Exit non-zero when budget check fails")
      .option("--timeout-ms <ms>", "Connection/reload timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .action(
        async (
          targetId: string | undefined,
          options: {
            budget: string;
            captureId?: string;
            artifactId?: string;
            profile?: string;
            captureMs: string;
            failOnViolation?: boolean;
            timeoutMs: number;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          try {
            const report = await targetNetworkCheck({
              budgetPath: options.budget,
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              captureId: options.captureId,
              artifactId: options.artifactId,
              profile: options.profile,
              captureMs: Number.parseInt(options.captureMs, 10),
            });
            ctx.printTargetSuccess(report, output);
            if (options.failOnViolation && !report.passed) {
              process.exitCode = 1;
            }
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};
