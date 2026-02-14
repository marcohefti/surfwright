import {
  parseFieldsCsv,
  projectReportFields,
  targetEmulate,
  targetExtract,
  targetFormFill,
  targetScreenshot,
} from "../../../core/usecases.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../core/types.js";
import { targetCommandMeta } from "../manifest.js";
import type { TargetCommandSpec } from "./types.js";

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
      .option("--no-persist", "Skip writing target metadata to local state", false)
      .option("--fields <csv>", "Return only selected top-level fields")
      .addHelpText(
        "after",
        [
          "",
          "Examples:",
          "  surfwright --json target extract <targetId> --kind blog --limit 5",
          "  surfwright --json target extract <targetId> --kind blog --frame-scope all --limit 10",
          "  surfwright --json target extract <targetId> --kind news --selector main --visible-only",
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
            noPersist?: boolean;
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
      .option("--timeout-ms <ms>", "Form fill timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state", false)
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            fieldsJson?: string;
            fieldsFile?: string;
            timeoutMs: number;
            noPersist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);

          try {
            const report = await targetFormFill({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              fieldsJson: options.fieldsJson,
              fieldsFile: options.fieldsFile,
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
      .option("--no-persist", "Skip writing target metadata to local state", false)
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
            noTouch?: boolean;
            deviceScaleFactor?: string;
            timeoutMs: number;
            noPersist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          const hasTouch = options.touch === true ? true : options.noTouch === true ? false : undefined;
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
      .option("--no-persist", "Skip writing target metadata to local state", false)
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
            noPersist?: boolean;
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
