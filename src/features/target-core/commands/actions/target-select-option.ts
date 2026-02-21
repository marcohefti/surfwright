import { parseFieldsCsv, projectReportFields, targetSelectOption } from "../../../../core/target/public.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../../core/types.js";
import { targetCommandMeta } from "../../manifest.js";
import type { TargetCommandSpec } from "../types.js";

const selectOptionMeta = targetCommandMeta("target.select-option");

export const targetSelectOptionCommandSpec: TargetCommandSpec = {
  id: selectOptionMeta.id,
  usage: selectOptionMeta.usage,
  summary: selectOptionMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("select-option")
      .description(selectOptionMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .requiredOption("--selector <query>", "CSS selector for a native <select> element")
      .option("--value <value>", "Select option by option.value")
      .option("--label <label>", "Select option by visible text label")
      .option("--option-index <n>", "Select option by zero-based index", (value) => Number.parseInt(value, 10))
      .option("--proof", "Include one-shot evidence payload for select-option result", false)
      .option("--assert-url-prefix <prefix>", "Post-select assertion: final URL must start with prefix")
      .option("--assert-selector <query>", "Post-select assertion: selector must be visible")
      .option("--assert-text <text>", "Post-select assertion: text must be present in page body")
      .option("--timeout-ms <ms>", "Select-option timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .addHelpText(
        "after",
        [
          "",
          "Examples:",
          "  surfwright target select-option <targetId> --selector '#country' --value CH --proof",
          "  surfwright target select-option <targetId> --selector '#role' --label 'Editor'",
          "  surfwright target select-option <targetId> --selector '#priority' --option-index 2",
        ].join("\n"),
      )
      .action(
        async (
          targetId: string,
          options: {
            selector: string;
            value?: string;
            label?: string;
            optionIndex?: number;
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
            const report = await targetSelectOption({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              selectorQuery: options.selector,
              value: options.value,
              label: options.label,
              optionIndex: typeof options.optionIndex === "number" ? options.optionIndex : undefined,
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
