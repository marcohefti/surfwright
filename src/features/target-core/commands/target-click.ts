import {
  parseFieldsCsv,
  projectReportFields,
  targetClick,
  targetClickAt,
  targetDragDrop,
  targetFill,
  targetKeypress,
  targetUpload,
} from "../../../core/target/public.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../core/types.js";
import { targetCommandMeta } from "../manifest.js";
import type { TargetCommandSpec } from "./types.js";
function collectRepeatedString(value: string, previous: string[]): string[] { return [...previous, value]; }
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
      .option("--handle <handle>", "Element handle (from target snapshot --mode a11y)")
      .option("--visible-only", "Only match visible elements")
      .option("--frame-scope <scope>", "Frame scope: main|all", "main")
      .option("--index <n>", "Pick the Nth match (0-based) instead of first match")
      .option("--explain", "Explain match selection/rejection without clicking", false)
      .option("--wait-for-text <text>", "After click, wait until text becomes visible")
      .option("--wait-for-selector <query>", "After click, wait until selector becomes visible")
      .option("--wait-network-idle", "After click, wait for network idle")
      .option("--wait-timeout-ms <ms>", "Post-click wait timeout budget in milliseconds", ctx.parseTimeoutMs)
      .option("--snapshot", "Include compact post-click text preview")
      .option("--delta", "Include bounded evidence-based delta after click", false)
      .option("--proof", "Include one-shot evidence payload (implies --snapshot and --delta)", false)
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
            handle?: string;
            visibleOnly?: boolean;
            frameScope?: string;
            index?: string;
            explain?: boolean;
            waitForText?: string;
            waitForSelector?: string;
            waitNetworkIdle?: boolean;
            waitTimeoutMs?: number;
            snapshot?: boolean;
            delta?: boolean;
            proof?: boolean;
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
              handle: options.handle,
              visibleOnly: Boolean(options.visibleOnly),
              frameScope: options.frameScope,
              index,
              explain: Boolean(options.explain),
              waitForText: options.waitForText,
              waitForSelector: options.waitForSelector,
              waitNetworkIdle: Boolean(options.waitNetworkIdle),
              waitTimeoutMs: options.waitTimeoutMs,
              snapshot: Boolean(options.snapshot),
              delta: Boolean(options.delta),
              proof: Boolean(options.proof),
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
      .option("--frame-scope <scope>", "Frame scope: main|all", "main")
      .requiredOption("--value <text>", "Value to fill into the matched control")
      .option("--wait-for-text <text>", "After fill, wait until text becomes visible")
      .option("--wait-for-selector <query>", "After fill, wait until selector becomes visible")
      .option("--wait-network-idle", "After fill, wait for network idle")
      .option("--wait-timeout-ms <ms>", "Post-fill wait timeout budget in milliseconds", ctx.parseTimeoutMs)
      .option("--proof", "Include one-shot evidence payload for fill result", false)
      .option("--timeout-ms <ms>", "Fill timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .addHelpText(
        "after",
        [
          "",
          "Examples:",
          "  surfwright target fill <targetId> --selector '#email' --value 'agent@example.com' --proof",
          "  surfwright target fill <targetId> --text 'Search' --value 'surfwright' --wait-network-idle",
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
            value: string;
            waitForText?: string;
            waitForSelector?: string;
            waitNetworkIdle?: boolean;
            waitTimeoutMs?: number;
            proof?: boolean;
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
              frameScope: options.frameScope,
              value: options.value,
              waitForText: options.waitForText,
              waitForSelector: options.waitForSelector,
              waitNetworkIdle: Boolean(options.waitNetworkIdle),
              waitTimeoutMs: options.waitTimeoutMs,
              proof: Boolean(options.proof),
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
      .option("--wait-for-text <text>", "After upload, wait until text becomes visible")
      .option("--wait-for-selector <query>", "After upload, wait until selector becomes visible")
      .option("--wait-network-idle", "After upload, wait for network idle")
      .option("--wait-timeout-ms <ms>", "Post-upload wait timeout budget in milliseconds", ctx.parseTimeoutMs)
      .option("--proof", "Include one-shot evidence payload for upload result", false)
      .option("--timeout-ms <ms>", "Upload timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .addHelpText(
        "after",
        [
          "",
          "Examples:",
          "  surfwright target upload <targetId> --selector 'input[type=file]' --file ./avatar.png --proof",
        ].join("\n"),
      )
      .action(
        async (
          targetId: string,
          options: {
            selector: string;
            file: string[];
            waitForText?: string;
            waitForSelector?: string;
            waitNetworkIdle?: boolean;
            waitTimeoutMs?: number;
            proof?: boolean;
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
              waitForText: options.waitForText,
              waitForSelector: options.waitForSelector,
              waitNetworkIdle: Boolean(options.waitNetworkIdle),
              waitTimeoutMs: options.waitTimeoutMs,
              proof: Boolean(options.proof),
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
      .option("--wait-for-text <text>", "After keypress, wait until text becomes visible")
      .option("--wait-for-selector <query>", "After keypress, wait until selector becomes visible")
      .option("--wait-network-idle", "After keypress, wait for network idle")
      .option("--wait-timeout-ms <ms>", "Post-keypress wait timeout budget in milliseconds", ctx.parseTimeoutMs)
      .option("--proof", "Include one-shot evidence payload for keypress result", false)
      .option("--timeout-ms <ms>", "Keypress timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .addHelpText(
        "after",
        [
          "",
          "Examples:",
          "  surfwright target keypress <targetId> --key Enter --selector '#search' --proof",
          "  surfwright target keypress <targetId> --key Escape --wait-for-selector '.modal[hidden]'",
        ].join("\n"),
      )
      .action(
        async (
          targetId: string,
          options: {
            key: string;
            text?: string;
            selector?: string;
            contains?: string;
            visibleOnly?: boolean;
            waitForText?: string;
            waitForSelector?: string;
            waitNetworkIdle?: boolean;
            waitTimeoutMs?: number;
            proof?: boolean;
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
              waitForText: options.waitForText,
              waitForSelector: options.waitForSelector,
              waitNetworkIdle: Boolean(options.waitNetworkIdle),
              waitTimeoutMs: options.waitTimeoutMs,
              proof: Boolean(options.proof),
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
      .option("--wait-for-text <text>", "After drag/drop, wait until text becomes visible")
      .option("--wait-for-selector <query>", "After drag/drop, wait until selector becomes visible")
      .option("--wait-network-idle", "After drag/drop, wait for network idle")
      .option("--wait-timeout-ms <ms>", "Post-drag/drop wait timeout budget in milliseconds", ctx.parseTimeoutMs)
      .option("--proof", "Include one-shot evidence payload for drag/drop result", false)
      .option("--timeout-ms <ms>", "Drag/drop timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .addHelpText(
        "after",
        [
          "",
          "Examples:",
          "  surfwright target drag-drop <targetId> --from '.source' --to '.target' --proof",
        ].join("\n"),
      )
      .action(
        async (
          targetId: string,
          options: {
            from: string;
            to: string;
            waitForText?: string;
            waitForSelector?: string;
            waitNetworkIdle?: boolean;
            waitTimeoutMs?: number;
            proof?: boolean;
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
              waitForText: options.waitForText,
              waitForSelector: options.waitForSelector,
              waitNetworkIdle: Boolean(options.waitNetworkIdle),
              waitTimeoutMs: options.waitTimeoutMs,
              proof: Boolean(options.proof),
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
