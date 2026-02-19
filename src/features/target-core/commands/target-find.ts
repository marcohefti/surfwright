import { parseFieldsCsv, projectReportFields, targetFind } from "../../../core/target/public.js";
import { DEFAULT_TARGET_FIND_LIMIT, DEFAULT_TARGET_TIMEOUT_MS } from "../../../core/types.js";
import { targetCommandMeta } from "../manifest.js";
import type { TargetCommandSpec } from "./types.js";

const meta = targetCommandMeta("target.find");

export const targetFindCommandSpec: TargetCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("find")
      .description(meta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--text <query>", "Text query for fuzzy text match")
      .option("--selector <query>", "CSS/Playwright selector query")
      .option("--contains <text>", "Text filter to apply with --selector")
      .option("--href-host <host>", "Only keep matches whose href host matches (e.g. github.com)")
      .option("--href-path-prefix <prefix>", "Only keep matches whose href path starts with prefix (e.g. /owner/)")
      .option("--visible-only", "Only return visible matches")
      .option("--frame-scope <scope>", "Frame scope: main|all", "main")
      .option("--first", "Return at most the first actionable match")
      .option("--limit <n>", "Maximum matches to return", String(DEFAULT_TARGET_FIND_LIMIT))
      .option("--timeout-ms <ms>", "Find timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            text?: string;
            selector?: string;
            contains?: string;
            hrefHost?: string;
            hrefPathPrefix?: string;
            visibleOnly?: boolean;
            frameScope?: string;
            first?: boolean;
            limit: string;
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const limit = Number.parseInt(options.limit, 10);
          const fields = parseFieldsCsv(options.fields);

          try {
            const report = await targetFind({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              textQuery: options.text,
              selectorQuery: options.selector,
              containsQuery: options.contains,
              hrefHost: options.hrefHost,
              hrefPathPrefix: options.hrefPathPrefix,
              visibleOnly: Boolean(options.visibleOnly),
              frameScope: options.frameScope,
              first: Boolean(options.first),
              limit,
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
