import {
  parseFieldsCsv,
  projectReportFields,
  queryInvalid,
  targetEmulate,
  targetExtract,
  targetFormFill,
  targetScreenshot,
} from "../../../core/target/public.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../core/types.js";
import { targetCommandMeta } from "../manifest.js";
import type { TargetCommandSpec } from "./types.js";

function collectRepeatedString(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseFieldAssignment(input: string): [string, string] {
  const index = input.indexOf("=");
  if (index <= 0) {
    throw queryInvalid("field must be formatted as <selector>=<value>");
  }
  const selector = input.slice(0, index).trim();
  if (selector.length === 0) {
    throw queryInvalid("field selector must not be empty");
  }
  return [selector, input.slice(index + 1)];
}

function fieldsJsonFromAssignments(fields: string[]): string {
  const entries = fields.map((item) => parseFieldAssignment(item));
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(Object.fromEntries(entries));
}

const extractMeta = targetCommandMeta("target.extract");

export const targetExtractCommandSpec: TargetCommandSpec = {
  id: extractMeta.id,
  usage: extractMeta.usage,
  summary: extractMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("extract")
      .description(extractMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--kind <kind>", "Extraction profile: generic|blog|news|docs")
      .option("--selector <query>", "Scope extraction to a selector")
      .option("--visible-only", "Only include visible content")
      .option("--frame-scope <scope>", "Frame scope: main|all", "main")
      .option("--limit <n>", "Maximum extracted items to return")
      .option("--timeout-ms <ms>", "Extraction timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .addHelpText(
        "after",
        [
          "",
          "Examples:",
          "  surfwright target extract <targetId> --kind blog --limit 5",
          "  surfwright target extract <targetId> --kind blog --frame-scope all --limit 10",
          "  surfwright target extract <targetId> --kind news --selector main --visible-only",
        ].join("\n"),
      )
      .action(
        async (
          targetId: string,
          options: {
            kind?: string;
            selector?: string;
            visibleOnly?: boolean;
            frameScope?: string;
            limit?: string;
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          const limit = typeof options.limit === "string" ? Number.parseInt(options.limit, 10) : undefined;
          try {
            const report = await targetExtract({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              kind: options.kind,
              selectorQuery: options.selector,
              visibleOnly: Boolean(options.visibleOnly),
              frameScope: options.frameScope,
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

const formFillMeta = targetCommandMeta("target.form-fill");

export const targetFormFillCommandSpec: TargetCommandSpec = {
  id: formFillMeta.id,
  usage: formFillMeta.usage,
  summary: formFillMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("form-fill")
      .description(formFillMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--fields-json <json>", "JSON object mapping selector -> value")
      .option("--fields-file <path>", "Read selector/value JSON from file")
      .option("--field <selector=value>", "Repeatable selector/value shorthand for string input values", collectRepeatedString, [])
      .option("--timeout-ms <ms>", "Form fill timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .addHelpText(
        "after",
        [
          "",
          "Examples:",
          "  surfwright target form-fill <targetId> --field '#email=agent@example.com' --field '#password=s3cret'",
          "  surfwright target form-fill <targetId> --fields-json '{\"#email\":\"agent@example.com\",\"#agree\":true}'",
        ].join("\n"),
      )
      .action(
        async (
          targetId: string,
          options: {
            fieldsJson?: string;
            fieldsFile?: string;
            field?: string[];
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          try {
            const inline = typeof options.fieldsJson === "string" ? options.fieldsJson.trim() : "";
            const file = typeof options.fieldsFile === "string" ? options.fieldsFile.trim() : "";
            const assignments = Array.isArray(options.field) ? options.field : [];
            const selected = Number(inline.length > 0) + Number(file.length > 0) + Number(assignments.length > 0);
            if (selected !== 1) {
              throw queryInvalid("Use exactly one form source: --fields-json, --fields-file, or --field");
            }
            const fieldsJson = assignments.length > 0 ? fieldsJsonFromAssignments(assignments) : options.fieldsJson;
            const report = await targetFormFill({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              fieldsJson,
              fieldsFile: options.fieldsFile,
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

const emulateMeta = targetCommandMeta("target.emulate");

export const targetEmulateCommandSpec: TargetCommandSpec = {
  id: emulateMeta.id,
  usage: emulateMeta.usage,
  summary: emulateMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("emulate")
      .description(emulateMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--width <n>", "Viewport width")
      .option("--height <n>", "Viewport height")
      .option("--user-agent <ua>", "Override browser user agent string")
      .option("--color-scheme <scheme>", "light|dark|no-preference")
      .option("--touch", "Enable touch emulation")
      .option("--no-touch", "Disable touch emulation")
      .option("--device-scale-factor <n>", "Device scale factor")
      .option("--timeout-ms <ms>", "Emulation timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            width?: string;
            height?: string;
            userAgent?: string;
            colorScheme?: string;
            touch?: boolean;
            deviceScaleFactor?: string;
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          const hasTouch = typeof options.touch === "boolean" ? options.touch : undefined;
          try {
            const report = await targetEmulate({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              width: typeof options.width === "string" ? Number.parseInt(options.width, 10) : undefined,
              height: typeof options.height === "string" ? Number.parseInt(options.height, 10) : undefined,
              userAgent: options.userAgent,
              colorScheme: options.colorScheme,
              hasTouch,
              deviceScaleFactor:
                typeof options.deviceScaleFactor === "string"
                  ? Number.parseFloat(options.deviceScaleFactor)
                  : undefined,
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

const screenshotMeta = targetCommandMeta("target.screenshot");

export const targetScreenshotCommandSpec: TargetCommandSpec = {
  id: screenshotMeta.id,
  usage: screenshotMeta.usage,
  summary: screenshotMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("screenshot")
      .description(screenshotMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .requiredOption("--out <path>", "Output file path")
      .option("--full-page", "Capture full scrollable page")
      .option("--type <type>", "png|jpeg", "png")
      .option("--quality <n>", "JPEG quality (0-100)")
      .option("--timeout-ms <ms>", "Screenshot timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            out: string;
            fullPage?: boolean;
            type?: string;
            quality?: string;
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          try {
            const report = await targetScreenshot({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              outPath: options.out,
              fullPage: Boolean(options.fullPage),
              type: options.type,
              quality: typeof options.quality === "string" ? Number.parseInt(options.quality, 10) : undefined,
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
