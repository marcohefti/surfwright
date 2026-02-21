import { parseFieldsCsv, projectReportFields, targetDownload } from "../../../../core/target/public.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../../core/types.js";
import { targetCommandMeta } from "../../manifest.js";
import type { TargetCommandSpec } from "../types.js";

const meta = targetCommandMeta("target.download");

export const targetDownloadCommandSpec: TargetCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("download")
      .description("Click a deterministic element and capture a download artifact")
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--text <query>", "Match element text for click")
      .option("--selector <query>", "Match selector for click")
      .option("--contains <text>", "Additional contains text filter for query")
      .option("--visible-only", "Only consider visible matches", false)
      .option("--frame-scope <scope>", "Frame scope: main|all (default main)")
      .option("--index <n>", "Match index (default picks first visible match)", (value) => Number.parseInt(value, 10))
      .option("--download-out-dir <path>", "Directory to write captured downloads (default ./artifacts/downloads)")
      .option("--allow-missing-download-event", "Return deterministic non-started download envelope instead of failing on download-event timeout", false)
      .option("--fallback-to-fetch", "When download event is missing, attempt deterministic fetch fallback capture", false)
      .option("--proof", "Include standardized proof envelope for download result", false)
      .option("--assert-url-prefix <prefix>", "Post-download assertion: final URL must start with prefix")
      .option("--assert-selector <query>", "Post-download assertion: selector must be visible")
      .option("--assert-text <text>", "Post-download assertion: text must be present in page body")
      .option("--timeout-ms <ms>", "Click/download timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .addHelpText(
        "after",
        [
          "",
          "Examples:",
          "  surfwright target download <targetId> --text 'Export CSV' --proof",
          "  surfwright target download <targetId> --text 'Download' --fallback-to-fetch --timeout-ms 2000",
        ].join("\n"),
      )
      .action(
        async (
          targetId: string,
          options: {
            text?: string;
            selector?: string;
            contains?: string;
            visibleOnly?: boolean;
            frameScope?: string;
            index?: number;
            downloadOutDir?: string;
            allowMissingDownloadEvent?: boolean;
            fallbackToFetch?: boolean;
            proof?: boolean;
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
            const report = await targetDownload({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              textQuery: options.text,
              selectorQuery: options.selector,
              containsQuery: options.contains,
              visibleOnly: Boolean(options.visibleOnly),
              frameScope: options.frameScope,
              index: typeof options.index === "number" ? options.index : undefined,
              downloadOutDir: typeof options.downloadOutDir === "string" ? options.downloadOutDir : undefined,
              allowMissingDownloadEvent: Boolean(options.allowMissingDownloadEvent),
              fallbackToFetch: Boolean(options.fallbackToFetch),
              proof: Boolean(options.proof),
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
