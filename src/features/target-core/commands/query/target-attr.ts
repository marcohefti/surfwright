import { parseFieldsCsv, projectReportFields, queryInvalid, targetAttr } from "../../../../core/target/public.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../../core/types.js";
import { targetCommandMeta } from "../../manifest.js";
import type { TargetCommandSpec } from "../types.js";

function parseNonNegativeIntegerOption(input: string | undefined, label: string): number | undefined {
  if (typeof input !== "string" || input.trim().length === 0) {
    return undefined;
  }
  const raw = input.trim();
  if (!/^\d+$/u.test(raw)) {
    throw queryInvalid(`${label} must be a non-negative integer`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw queryInvalid(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function parsePositiveIntegerOption(input: string | undefined, label: string): number | undefined {
  if (typeof input !== "string" || input.trim().length === 0) {
    return undefined;
  }
  const raw = input.trim();
  if (!/^\d+$/u.test(raw)) {
    throw queryInvalid(`${label} must be a positive integer`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw queryInvalid(`${label} must be a positive integer`);
  }
  return parsed;
}

const meta = targetCommandMeta("target.attr");

export const targetAttrCommandSpec: TargetCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("attr")
      .description(meta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--text <query>", "Text query for fuzzy text match")
      .option("--selector <query>", "CSS selector query")
      .option("--contains <text>", "Text filter to apply with --selector")
      .requiredOption("--name <attribute>", "Attribute name to read (for example: href, src, aria-label)")
      .option("--visible-only", "Only match visible elements")
      .option("--frame-scope <scope>", "Frame scope: main|all", "main")
      .option("--index <n>", "Pick the Nth match (0-based) instead of first match")
      .option("--nth <n>", "Pick the Nth match (1-based) instead of first match")
      .option("--timeout-ms <ms>", "Attribute-read timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .addHelpText(
        "after",
        [
          "",
          "Examples:",
          "  surfwright target attr <targetId> --selector 'img.avatar' --name src",
          "  surfwright target attr <targetId> --text 'Docs' --name href --visible-only",
          "  surfwright target attr <targetId> --selector '.card a' --name href --nth 2",
        ].join("\n"),
      )
      .action(
        async (
          targetId: string,
          options: {
            text?: string;
            selector?: string;
            contains?: string;
            name: string;
            visibleOnly?: boolean;
            frameScope?: string;
            index?: string;
            nth?: string;
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          const indexOption = parseNonNegativeIntegerOption(options.index, "index");
          const nthOption = parsePositiveIntegerOption(options.nth, "nth");
          if (typeof indexOption === "number" && typeof nthOption === "number") {
            throw queryInvalid("--index and --nth cannot be combined");
          }
          const index = typeof nthOption === "number" ? nthOption - 1 : indexOption;
          try {
            const report = await targetAttr({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              textQuery: options.text,
              selectorQuery: options.selector,
              containsQuery: options.contains,
              attributeName: options.name,
              visibleOnly: Boolean(options.visibleOnly),
              frameScope: options.frameScope,
              index,
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
