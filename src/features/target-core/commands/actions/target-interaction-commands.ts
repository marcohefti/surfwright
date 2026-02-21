import {
  parseFieldsCsv,
  projectReportFields,
  targetClick,
  targetDragDrop,
  targetFill,
  targetKeypress,
  targetRead,
  targetUpload,
} from "../../../../core/target/public.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../../core/types.js";
import type { TargetClickReport } from "../../../../core/types.js";
import { targetCommandMeta } from "../../manifest.js";
import type { TargetCommandSpec } from "../types.js";

function collectRepeatedString(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const clickReadMeta = targetCommandMeta("target.click-read");
export const targetClickReadCommandSpec: TargetCommandSpec = {
  id: clickReadMeta.id,
  usage: clickReadMeta.usage,
  summary: clickReadMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("click-read")
      .description(clickReadMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--text <query>", "Text query for fuzzy text match")
      .option("--selector <query>", "CSS/Playwright selector query")
      .option("--contains <text>", "Text filter to apply with --selector")
      .option("--visible-only", "Only match visible elements")
      .option("--within <selector>", "Scope query resolution to descendants of selector")
      .option("--frame-scope <scope>", "Frame scope: main|all", "main")
      .option("--index <n>", "Pick the Nth match (0-based) instead of first match")
      .option("--wait-for-text <text>", "After click, wait until text becomes visible")
      .option("--wait-for-selector <query>", "After click, wait until selector becomes visible")
      .option("--wait-network-idle", "After click, wait for network idle")
      .option("--wait-timeout-ms <ms>", "Post-click wait timeout budget in milliseconds", ctx.parseTimeoutMs)
      .option("--read-selector <query>", "Read scope selector after click")
      .option("--read-visible-only", "Read only visible text after click")
      .option("--read-frame-scope <scope>", "Read frame scope: main|all")
      .option("--chunk-size <n>", "Read chunk size in characters")
      .option("--chunk <n>", "Read chunk index (1-based)")
      .option("--timeout-ms <ms>", "Command timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .addHelpText(
        "after",
        [
          "",
          "Examples:",
          "  surfwright target click-read <targetId> --text 'Pricing' --read-selector main --chunk-size 1200 --chunk 1",
          "  surfwright target click-read <targetId> --selector 'a.docs' --read-visible-only --read-frame-scope all",
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
            within?: string;
            frameScope?: string;
            index?: string;
            waitForText?: string;
            waitForSelector?: string;
            waitNetworkIdle?: boolean;
            waitTimeoutMs?: number;
            readSelector?: string;
            readVisibleOnly?: boolean;
            readFrameScope?: string;
            chunkSize?: string;
            chunk?: string;
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          const index = typeof options.index === "string" ? Number.parseInt(options.index, 10) : undefined;
          const chunkSize = typeof options.chunkSize === "string" ? Number.parseInt(options.chunkSize, 10) : undefined;
          const chunkIndex = typeof options.chunk === "string" ? Number.parseInt(options.chunk, 10) : undefined;
          try {
            const clickReport = await targetClick({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              textQuery: options.text,
              selectorQuery: options.selector,
              containsQuery: options.contains,
              visibleOnly: Boolean(options.visibleOnly),
              withinSelector: options.within,
              frameScope: options.frameScope,
              index,
              waitForText: options.waitForText,
              waitForSelector: options.waitForSelector,
              waitNetworkIdle: Boolean(options.waitNetworkIdle),
              waitTimeoutMs: options.waitTimeoutMs,
              snapshot: false,
              delta: false,
              proof: false,
              persistState: options.persist !== false,
            });
            const clickResult = clickReport as TargetClickReport;
            const readTargetId =
              !clickResult.handoff.sameTarget && typeof clickResult.handoff.openedTargetId === "string" && clickResult.handoff.openedTargetId.length > 0
                ? clickResult.handoff.openedTargetId
                : clickResult.targetId;
            const readReport = await targetRead({
              targetId: readTargetId,
              timeoutMs: options.timeoutMs,
              sessionId: clickResult.sessionId,
              selectorQuery: options.readSelector,
              visibleOnly: Boolean(options.readVisibleOnly),
              frameScope: options.readFrameScope ?? options.frameScope,
              chunkSize,
              chunkIndex,
              persistState: options.persist !== false,
            });

            const report = {
              ok: true,
              sessionId: clickResult.sessionId,
              targetId: readTargetId,
              click: {
                actionId: clickResult.actionId,
                targetId: clickResult.targetId,
                mode: clickResult.mode,
                query: clickResult.query,
                selector: clickResult.selector,
                matchCount: clickResult.matchCount,
                pickedIndex: clickResult.pickedIndex,
                handoff: clickResult.handoff,
              },
              read: readReport,
            };
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
      .option("--frame-scope <scope>", "Frame scope: main|all", "main")
      .requiredOption("--value <text>", "Value to fill into the matched control")
      .option("--events <csv>", "Dispatch additional events after fill (csv: input,change,keyup,keydown,keypress,blur)")
      .option("--event-mode <mode>", "Fill event preset: minimal|realistic|none")
      .option("--wait-for-text <text>", "After fill, wait until text becomes visible")
      .option("--wait-for-selector <query>", "After fill, wait until selector becomes visible")
      .option("--wait-network-idle", "After fill, wait for network idle")
      .option("--wait-timeout-ms <ms>", "Post-fill wait timeout budget in milliseconds", ctx.parseTimeoutMs)
      .option("--proof", "Include one-shot evidence payload for fill result", false)
      .option("--assert-url-prefix <prefix>", "Post-fill assertion: final URL must start with prefix")
      .option("--assert-selector <query>", "Post-fill assertion: selector must be visible")
      .option("--assert-text <text>", "Post-fill assertion: text must be present in page body")
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
            events?: string;
            eventMode?: string;
            waitForText?: string;
            waitForSelector?: string;
            waitNetworkIdle?: boolean;
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
              eventsInput: options.events,
              eventModeInput: options.eventMode,
              waitForText: options.waitForText,
              waitForSelector: options.waitForSelector,
              waitNetworkIdle: Boolean(options.waitNetworkIdle),
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
      .option("--assert-url-prefix <prefix>", "Post-keypress assertion: final URL must start with prefix")
      .option("--assert-selector <query>", "Post-keypress assertion: selector must be visible")
      .option("--assert-text <text>", "Post-keypress assertion: text must be present in page body")
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
      .option("--assert-url-prefix <prefix>", "Post-drag/drop assertion: final URL must start with prefix")
      .option("--assert-selector <query>", "Post-drag/drop assertion: selector must be visible")
      .option("--assert-text <text>", "Post-drag/drop assertion: text must be present in page body")
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
