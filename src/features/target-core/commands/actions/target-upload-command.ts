import { parseFieldsCsv, projectReportFields, targetUpload } from "../../../../core/target/public.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../../core/types.js";
import { targetCommandMeta } from "../../manifest.js";
import type { TargetCommandSpec } from "../types.js";

function collectRepeatedString(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const uploadMeta = targetCommandMeta("target.upload");
export const targetUploadCommandSpec: TargetCommandSpec = {
  id: uploadMeta.id,
  usage: uploadMeta.usage,
  summary: uploadMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("upload")
      .description(uploadMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .requiredOption("--selector <query>", "CSS selector for file input/chooser trigger")
      .requiredOption("--file <path>", "File path to upload (repeat for multiple files)", collectRepeatedString, [])
      .option("--wait-for-text <text>", "After upload, wait until text becomes visible")
      .option("--wait-for-selector <query>", "After upload, wait until selector becomes visible")
      .option("--wait-network-idle", "After upload, wait for network idle")
      .option("--submit-selector <query>", "Optional submit selector clicked after files are attached")
      .option("--expect-uploaded-filename <name>", "Assert uploaded filename appears in page result text")
      .option("--wait-for-result", "Wait until upload result verification criteria are satisfied")
      .option("--result-selector <query>", "Optional result selector used for upload result verification")
      .option("--result-text-contains <text>", "Upload result verification: required text snippet")
      .option("--result-filename-regex <pattern>", "Upload result verification: required filename regex")
      .option("--wait-timeout-ms <ms>", "Post-upload wait timeout budget in milliseconds", ctx.parseTimeoutMs)
      .option("--proof", "Include one-shot evidence payload for upload result", false)
      .option("--assert-url-prefix <prefix>", "Post-upload assertion: final URL must start with prefix")
      .option("--assert-selector <query>", "Post-upload assertion: selector must be visible")
      .option("--assert-text <text>", "Post-upload assertion: text must be present in page body")
      .option("--timeout-ms <ms>", "Upload timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .addHelpText(
        "after",
        [
          "",
          "Examples:",
          "  surfwright target upload <targetId> --selector 'input[type=file]' --file ./avatar.png --proof",
          "  surfwright target upload <targetId> --selector '#file' --file ./report.csv --submit-selector 'button[type=submit]' --wait-for-text 'uploaded'",
          "  surfwright target upload <targetId> --selector '#file' --file ./report.csv --submit-selector 'button[type=submit]' --expect-uploaded-filename report.csv",
          "  surfwright target upload <targetId> --selector '#file' --file ./report.csv --submit-selector '#submit' --wait-for-result --result-selector '#uploaded-files' --result-filename-regex 'report\\\\.csv'",
        ].join("\n"),
      )
      .action(
        async (
          targetId: string,
          options: {
            selector: string;
            file: string[];
            submitSelector?: string;
            waitForText?: string;
            waitForSelector?: string;
            waitNetworkIdle?: boolean;
            expectUploadedFilename?: string;
            waitForResult?: boolean;
            resultSelector?: string;
            resultTextContains?: string;
            resultFilenameRegex?: string;
            waitTimeoutMs?: number;
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
            const report = await targetUpload({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              selectorQuery: options.selector,
              files: options.file,
              submitSelector: options.submitSelector,
              waitForText: options.waitForText,
              waitForSelector: options.waitForSelector,
              waitNetworkIdle: Boolean(options.waitNetworkIdle),
              expectUploadedFilename: options.expectUploadedFilename,
              waitForResult: Boolean(options.waitForResult),
              resultSelector: options.resultSelector,
              resultTextContains: options.resultTextContains,
              resultFilenameRegex: options.resultFilenameRegex,
              waitTimeoutMs: options.waitTimeoutMs,
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
