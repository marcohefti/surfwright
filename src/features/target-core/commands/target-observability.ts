import { parseFieldsCsv, projectReportFields, targetConsoleGet, targetConsoleTail, targetHealth, targetHud } from "../../../core/usecases.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../core/types.js";
import { targetCommandMeta } from "../manifest.js";
import type { TargetCommandSpec } from "./types.js";

function writeNdjson(value: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

const consoleGetMeta = targetCommandMeta("target.console-get");
const consoleTailMeta = targetCommandMeta("target.console-tail");
const healthMeta = targetCommandMeta("target.health");
const hudMeta = targetCommandMeta("target.hud");

export const targetConsoleGetCommandSpec: TargetCommandSpec = {
  id: consoleGetMeta.id,
  usage: consoleGetMeta.usage,
  summary: consoleGetMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("console-get")
      .description(consoleGetMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--capture-ms <ms>", "Capture duration in milliseconds", "2500")
      .option("--levels <csv>", "Console levels to scan: log,info,warn,error,debug")
      .option("--contains <text>", "Only match events whose text contains this substring")
      .option("--reload", "Reload page before capture")
      .option("--timeout-ms <ms>", "Connection/reload timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .addHelpText(
        "after",
        [
          "",
          "Examples:",
          "  surfwright --json target console-get <targetId> --contains PARITY_CONSOLE_SENTINEL_20260214",
          "  surfwright --json --session s-1 target console-get <targetId> --reload --capture-ms 1200 --levels error,warn",
        ].join("\n"),
      )
      .action(
        async (
          targetId: string,
          options: {
            captureMs: string;
            levels?: string;
            contains?: string;
            reload?: boolean;
            timeoutMs: number;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          try {
            const report = await targetConsoleGet({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              captureMs: Number.parseInt(options.captureMs, 10),
              levels: options.levels,
              contains: options.contains,
              reload: Boolean(options.reload),
            });
            ctx.printTargetSuccess(report, output);
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};

export const targetConsoleTailCommandSpec: TargetCommandSpec = {
  id: consoleTailMeta.id,
  usage: consoleTailMeta.usage,
  summary: consoleTailMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("console-tail")
      .description(consoleTailMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--capture-ms <ms>", "Capture duration in milliseconds", "2500")
      .option("--max-events <n>", "Maximum events to emit", "120")
      .option("--levels <csv>", "Console levels to stream: log,info,warn,error,debug")
      .option("--reload", "Reload page before streaming")
      .option("--timeout-ms <ms>", "Connection/reload timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .addHelpText(
        "after",
        [
          "",
          "Examples:",
          "  surfwright target console-tail <targetId> --levels error,warn --capture-ms 2000",
          "  surfwright --session s-1 target console-tail <targetId> --reload --capture-ms 3000",
        ].join("\n"),
      )
      .action(
        async (
          targetId: string,
          options: {
            captureMs: string;
            maxEvents: string;
            levels?: string;
            reload?: boolean;
            timeoutMs: number;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          try {
            const report = await targetConsoleTail({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              captureMs: Number.parseInt(options.captureMs, 10),
              maxEvents: Number.parseInt(options.maxEvents, 10),
              levels: options.levels,
              reload: Boolean(options.reload),
              onEvent: (event) => writeNdjson(event),
            });
            if (!output.json) {
              process.stdout.write(
                [
                  "ok",
                  `sessionId=${report.sessionId}`,
                  `targetId=${report.targetId}`,
                  `seen=${report.seen}`,
                  `emitted=${report.emitted}`,
                ].join(" ") + "\n",
              );
            }
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};

export const targetHealthCommandSpec: TargetCommandSpec = {
  id: healthMeta.id,
  usage: healthMeta.usage,
  summary: healthMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("health")
      .description(healthMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--timeout-ms <ms>", "Health probe timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--fields <csv>", "Return only selected top-level fields")
      .addHelpText(
        "after",
        [
          "",
          "Examples:",
          "  surfwright --json target health <targetId>",
          "  surfwright --json target health <targetId> --fields readyState,metrics,hints",
        ].join("\n"),
      )
      .action(async (targetId: string, options: { timeoutMs: number; fields?: string }) => {
        const output = ctx.globalOutputOpts();
        const globalOpts = ctx.program.opts<{ session?: string }>();
        const fields = parseFieldsCsv(options.fields);
        try {
          const report = await targetHealth({
            targetId,
            timeoutMs: options.timeoutMs,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
          });
          ctx.printTargetSuccess(projectReportFields(report as unknown as Record<string, unknown>, fields), output);
        } catch (error) {
          ctx.handleFailure(error, output);
        }
      });
  },
};

export const targetHudCommandSpec: TargetCommandSpec = {
  id: hudMeta.id,
  usage: hudMeta.usage,
  summary: hudMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("hud")
      .description(hudMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--timeout-ms <ms>", "HUD timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(async (targetId: string, options: { timeoutMs: number; fields?: string }) => {
        const output = ctx.globalOutputOpts();
        const globalOpts = ctx.program.opts<{ session?: string }>();
        const fields = parseFieldsCsv(options.fields);
        try {
          const report = await targetHud({
            targetId,
            timeoutMs: options.timeoutMs,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
          });
          ctx.printTargetSuccess(projectReportFields(report as unknown as Record<string, unknown>, fields), output);
        } catch (error) {
          ctx.handleFailure(error, output);
        }
      });
  },
};
