import { parseFieldsCsv, projectReportFields, targetUrlAssert } from "../../../../core/target/public.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../../core/types.js";
import { targetCommandMeta } from "../../manifest.js";
import type { TargetCommandSpec } from "../types.js";

const meta = targetCommandMeta("target.url-assert");

export const targetUrlAssertCommandSpec: TargetCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("url-assert")
      .description(meta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--host <host>", "Assert URL hostname matches (e.g. example.com)")
      .option("--origin <origin>", "Assert URL origin matches (e.g. https://example.com)")
      .option("--path-prefix <prefix>", "Assert URL path prefix matches (e.g. /docs)")
      .option("--url-prefix <prefix>", "Assert full URL string starts with prefix (e.g. https://example.com/)")
      .option("--timeout-ms <ms>", "Assert timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            host?: string;
            origin?: string;
            pathPrefix?: string;
            urlPrefix?: string;
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          try {
            const report = await targetUrlAssert({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              host: options.host,
              origin: options.origin,
              pathPrefix: options.pathPrefix,
              urlPrefix: options.urlPrefix,
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
