import { parseFieldsCsv, projectReportFields, targetClick } from "../../../core/usecases.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../core/types.js";
import { targetCommandMeta } from "../manifest.js";
import type { TargetCommandSpec } from "./types.js";

const meta = targetCommandMeta("target.click");

export const targetClickCommandSpec: TargetCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("click")
      .description(meta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--text <query>", "Text query for fuzzy text match")
      .option("--selector <query>", "CSS/Playwright selector query")
      .option("--contains <text>", "Text filter to apply with --selector")
      .option("--visible-only", "Only match visible elements")
      .option("--wait-for-text <text>", "After click, wait until text becomes visible")
      .option("--wait-for-selector <query>", "After click, wait until selector becomes visible")
      .option("--wait-network-idle", "After click, wait for network idle")
      .option("--snapshot", "Include compact post-click text preview")
      .option("--timeout-ms <ms>", "Click timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state", false)
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            text?: string;
            selector?: string;
            contains?: string;
            visibleOnly?: boolean;
            waitForText?: string;
            waitForSelector?: string;
            waitNetworkIdle?: boolean;
            snapshot?: boolean;
            timeoutMs: number;
            noPersist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          try {
            const report = await targetClick({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              textQuery: options.text,
              selectorQuery: options.selector,
              containsQuery: options.contains,
              visibleOnly: Boolean(options.visibleOnly),
              waitForText: options.waitForText,
              waitForSelector: options.waitForSelector,
              waitNetworkIdle: Boolean(options.waitNetworkIdle),
              snapshot: Boolean(options.snapshot),
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
