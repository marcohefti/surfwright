import {
  parseFieldsCsv,
  projectReportFields,
  targetClick,
  targetClickAt,
  targetClose,
  targetDialog,
  targetDragDrop,
  targetFill,
  targetKeypress,
  targetSpawn,
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
      .option("--index <n>", "Pick the Nth match (0-based) instead of first match")
      .option("--explain", "Explain match selection/rejection without clicking", false)
      .option("--wait-for-text <text>", "After click, wait until text becomes visible")
      .option("--wait-for-selector <query>", "After click, wait until selector becomes visible")
      .option("--wait-network-idle", "After click, wait for network idle")
      .option("--snapshot", "Include compact post-click text preview")
      .option("--delta", "Include bounded evidence-based delta after click", false)
      .option("--timeout-ms <ms>", "Click timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            text?: string;
            selector?: string;
            contains?: string;
            visibleOnly?: boolean;
            index?: string;
            explain?: boolean;
            waitForText?: string;
            waitForSelector?: string;
            waitNetworkIdle?: boolean;
            snapshot?: boolean;
            delta?: boolean;
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          const index = typeof options.index === "string" ? Number.parseInt(options.index, 10) : undefined;
          try {
            const report = await targetClick({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              textQuery: options.text,
              selectorQuery: options.selector,
              containsQuery: options.contains,
              visibleOnly: Boolean(options.visibleOnly),
              index,
              explain: Boolean(options.explain),
              waitForText: options.waitForText,
              waitForSelector: options.waitForSelector,
              waitNetworkIdle: Boolean(options.waitNetworkIdle),
              snapshot: Boolean(options.snapshot),
              delta: Boolean(options.delta),
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
const clickAtMeta = targetCommandMeta("target.click-at");
export const targetClickAtCommandSpec: TargetCommandSpec = {
  id: clickAtMeta.id,
  usage: clickAtMeta.usage,
  summary: clickAtMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("click-at")
      .description(clickAtMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .requiredOption("--x <n>", "Viewport x coordinate")
      .requiredOption("--y <n>", "Viewport y coordinate")
      .option("--button <button>", "Mouse button: left|middle|right", "left")
      .option("--click-count <n>", "Number of clicks to send", "1")
      .option("--timeout-ms <ms>", "Click timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(async (targetId: string, options: { x: string; y: string; button?: string; clickCount?: string; timeoutMs: number; persist?: boolean; fields?: string }) => {
        const output = ctx.globalOutputOpts();
        const globalOpts = ctx.program.opts<{ session?: string }>();
        const fields = parseFieldsCsv(options.fields);
        try {
          const report = await targetClickAt({
            targetId,
            timeoutMs: options.timeoutMs,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
            x: Number.parseFloat(options.x),
            y: Number.parseFloat(options.y),
            button: options.button,
            clickCount: typeof options.clickCount === "string" ? Number.parseInt(options.clickCount, 10) : undefined,
            persistState: options.persist !== false,
          });
          ctx.printTargetSuccess(projectReportFields(report as unknown as Record<string, unknown>, fields), output);
        } catch (error) {
          ctx.handleFailure(error, output);
        }
      });
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
      .option("--no-persist", "Skip writing target metadata to local state")
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
            persist?: boolean;
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
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            selector: string;
            file: string[];
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
      .option("--no-persist", "Skip writing target metadata to local state")
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
            persist?: boolean;
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
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            from: string;
            to: string;
            timeoutMs: number;
            persist?: boolean;
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

const spawnMeta = targetCommandMeta("target.spawn");

export const targetSpawnCommandSpec: TargetCommandSpec = {
  id: spawnMeta.id,
  usage: spawnMeta.usage,
  summary: spawnMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("spawn")
      .description(spawnMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--text <query>", "Text query for fuzzy text match")
      .option("--selector <query>", "CSS/Playwright selector query")
      .option("--contains <text>", "Text filter to apply with --selector")
      .option("--visible-only", "Only match visible elements")
      .option("--timeout-ms <ms>", "Spawn timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            text?: string;
            selector?: string;
            contains?: string;
            visibleOnly?: boolean;
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          try {
            const report = await targetSpawn({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              textQuery: options.text,
              selectorQuery: options.selector,
              containsQuery: options.contains,
              visibleOnly: Boolean(options.visibleOnly),
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

const closeMeta = targetCommandMeta("target.close");

export const targetCloseCommandSpec: TargetCommandSpec = {
  id: closeMeta.id,
  usage: closeMeta.usage,
  summary: closeMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("close")
      .description(closeMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--timeout-ms <ms>", "Close timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          try {
            const report = await targetClose({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
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

const dialogMeta = targetCommandMeta("target.dialog");

export const targetDialogCommandSpec: TargetCommandSpec = {
  id: dialogMeta.id,
  usage: dialogMeta.usage,
  summary: dialogMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("dialog")
      .description(dialogMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--action <action>", "Dialog action: accept|dismiss", "accept")
      .option("--prompt-text <text>", "Prompt text used when action=accept for prompt dialogs")
      .option("--trigger-text <query>", "Optionally click a text-matched trigger before waiting for dialog")
      .option("--trigger-selector <query>", "Optionally click a selector-matched trigger before waiting for dialog")
      .option("--contains <text>", "Text filter to apply with --trigger-selector")
      .option("--visible-only", "Only match visible trigger elements")
      .option("--timeout-ms <ms>", "Dialog timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            action?: string;
            promptText?: string;
            triggerText?: string;
            triggerSelector?: string;
            contains?: string;
            visibleOnly?: boolean;
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          try {
            const report = await targetDialog({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              action: options.action,
              promptText: options.promptText,
              triggerText: options.triggerText,
              triggerSelector: options.triggerSelector,
              containsQuery: options.contains,
              visibleOnly: Boolean(options.visibleOnly),
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
