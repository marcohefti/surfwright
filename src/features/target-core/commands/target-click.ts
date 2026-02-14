import {
  parseFieldsCsv,
  projectReportFields,
  targetClick,
  targetDragDrop,
  targetFill,
  targetKeypress,
  targetUpload,
} from "../../../core/usecases.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../core/types.js";
import { targetCommandMeta } from "../manifest.js";
import type { TargetCommandSpec } from "./types.js";

function collectRepeatedString(value: string, previous: string[]): string[] {
  return [...previous, value];
}

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

const fillMeta = targetCommandMeta("target.fill");

export const targetFillCommandSpec: TargetCommandSpec = {
  id: fillMeta.id,
  usage: fillMeta.usage,
  summary: fillMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("fill")
      .description(fillMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--text <query>", "Text query for fuzzy text match")
      .option("--selector <query>", "CSS/Playwright selector query")
      .option("--contains <text>", "Text filter to apply with --selector")
      .option("--visible-only", "Only match visible elements")
      .requiredOption("--value <text>", "Value to fill into the matched control")
      .option("--timeout-ms <ms>", "Fill timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
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
            value: string;
            timeoutMs: number;
            noPersist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          try {
            const report = await targetFill({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              textQuery: options.text,
              selectorQuery: options.selector,
              containsQuery: options.contains,
              visibleOnly: Boolean(options.visibleOnly),
              value: options.value,
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
      .option("--timeout-ms <ms>", "Upload timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state", false)
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            selector: string;
            file: string[];
            timeoutMs: number;
            noPersist?: boolean;
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

const keypressMeta = targetCommandMeta("target.keypress");

export const targetKeypressCommandSpec: TargetCommandSpec = {
  id: keypressMeta.id,
  usage: keypressMeta.usage,
  summary: keypressMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("keypress")
      .description(keypressMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .requiredOption("--key <key>", "Playwright key value (Enter, Escape, ArrowDown, etc.)")
      .option("--text <query>", "Text query for fuzzy text match")
      .option("--selector <query>", "CSS/Playwright selector query")
      .option("--contains <text>", "Text filter to apply with --selector")
      .option("--visible-only", "Only match visible elements")
      .option("--timeout-ms <ms>", "Keypress timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state", false)
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            key: string;
            text?: string;
            selector?: string;
            contains?: string;
            visibleOnly?: boolean;
            timeoutMs: number;
            noPersist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);

          try {
            const report = await targetKeypress({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              key: options.key,
              textQuery: options.text,
              selectorQuery: options.selector,
              containsQuery: options.contains,
              visibleOnly: Boolean(options.visibleOnly),
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

const dragDropMeta = targetCommandMeta("target.drag-drop");

export const targetDragDropCommandSpec: TargetCommandSpec = {
  id: dragDropMeta.id,
  usage: dragDropMeta.usage,
  summary: dragDropMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("drag-drop")
      .description(dragDropMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .requiredOption("--from <selector>", "Source selector for drag start")
      .requiredOption("--to <selector>", "Destination selector for drag end")
      .option("--timeout-ms <ms>", "Drag/drop timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state", false)
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            from: string;
            to: string;
            timeoutMs: number;
            noPersist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);

          try {
            const report = await targetDragDrop({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              fromSelector: options.from,
              toSelector: options.to,
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
