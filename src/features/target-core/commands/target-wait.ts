import { parseFieldsCsv, projectReportFields, targetWait } from "../../../core/target/public.js";
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
      .option("--frame-scope <scope>", "Frame scope: main|all", "main")
      .option("--wait-timeout-ms <ms>", "Wait-stage timeout budget in milliseconds", ctx.parseTimeoutMs)
      .option("--assert-url-prefix <prefix>", "Post-wait assertion: final URL must start with prefix")
      .option("--assert-selector <query>", "Post-wait assertion: selector must be visible")
      .option("--assert-text <text>", "Post-wait assertion: text must be present in page body")
      .option("--timeout-ms <ms>", "Wait timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .addHelpText(
        "after",
        [
          "",
          "Examples:",
          "  surfwright target wait <targetId> --for-selector '.loaded' --wait-timeout-ms 5000",
          "  surfwright target wait <targetId> --for-text 'Pricing' --frame-scope all",
        ].join("\n"),
      )
      .action(
        async (
          targetId: string,
          options: {
            forText?: string;
            forSelector?: string;
            networkIdle?: boolean;
            frameScope?: string;
            waitTimeoutMs?: number;
            assertUrlPrefix?: string;
            assertSelector?: string;
            assertText?: string;
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          try {
            const report = await targetWait({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              forText: options.forText,
              forSelector: options.forSelector,
              networkIdle: Boolean(options.networkIdle),
              frameScope: options.frameScope,
              waitTimeoutMs: options.waitTimeoutMs,
              assertUrlPrefix: options.assertUrlPrefix,
              assertSelector: options.assertSelector,
              assertText: options.assertText,
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
