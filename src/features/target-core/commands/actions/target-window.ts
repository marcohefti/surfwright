import { parseFieldsCsv, projectReportFields, targetClose, targetDialog, targetSpawn } from "../../../../core/target/public.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../../core/types.js";
import { targetCommandMeta } from "../../manifest.js";
import type { TargetCommandSpec } from "../types.js";

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
      .option("--frame-scope <scope>", "Frame scope: main|all", "main")
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
            frameScope?: string;
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
              frameScope: options.frameScope,
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
      .option("--wait-for-text <text>", "After dialog action, wait until text becomes visible")
      .option("--wait-for-selector <query>", "After dialog action, wait until selector becomes visible")
      .option("--wait-network-idle", "After dialog action, wait for network idle")
      .option("--wait-timeout-ms <ms>", "Post-dialog wait timeout budget in milliseconds", ctx.parseTimeoutMs)
      .option("--proof", "Include one-shot evidence payload for dialog result", false)
      .option("--timeout-ms <ms>", "Dialog timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .addHelpText(
        "after",
        [
          "",
          "Examples:",
          "  surfwright target dialog <targetId> --trigger-text 'Delete' --action dismiss --proof",
        ].join("\n"),
      )
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
