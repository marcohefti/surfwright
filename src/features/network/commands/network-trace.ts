import type { Command } from "commander";
import { targetNetworkCaptureBegin, targetTraceExport, targetTraceInsight } from "../../../core/network/public.js";
import {
  DEFAULT_TARGET_NETWORK_CAPTURE_MS,
  DEFAULT_TARGET_NETWORK_MAX_RUNTIME_MS,
  DEFAULT_TARGET_TIMEOUT_MS,
} from "../../../core/types.js";
import { networkCommandMeta } from "../manifest.js";
import type { NetworkCommandSpec } from "./types.js";

const beginMeta = networkCommandMeta("target.trace.begin");
const exportMeta = networkCommandMeta("target.trace.export");
const insightMeta = networkCommandMeta("target.trace.insight");

function ensureTraceCommand(target: Command): Command {
  const existing = target.commands.find((command) => command.name() === "trace");
  if (existing) {
    return existing;
  }
  return target.command("trace").description("Trace workflows for performance diagnostics");
}

export const traceBeginCommandSpec: NetworkCommandSpec = {
  id: beginMeta.id,
  usage: beginMeta.usage,
  summary: beginMeta.summary,
  register: (ctx) => {
    ensureTraceCommand(ctx.target)
      .command("begin")
      .description(beginMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--action-id <id>", "Correlation action id for this capture window")
      .option("--profile <preset>", "Preset capture profile: custom|api|page|ws|perf", "perf")
      .option("--max-runtime-ms <ms>", "Maximum recorder runtime in milliseconds", String(DEFAULT_TARGET_NETWORK_MAX_RUNTIME_MS))
      .option("--timeout-ms <ms>", "Connection timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .action(
        async (
          targetId: string,
          options: {
            actionId?: string;
            profile?: string;
            maxRuntimeMs: string;
            timeoutMs: number;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          try {
            const report = await targetNetworkCaptureBegin({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              actionId: options.actionId,
              profile: options.profile,
              maxRuntimeMs: Number.parseInt(options.maxRuntimeMs, 10),
            });
            ctx.printTargetSuccess(
              {
                ok: true,
                sessionId: report.sessionId,
                sessionSource: report.sessionSource,
                targetId: report.targetId,
                traceId: report.captureId,
                actionId: report.actionId,
                status: report.status,
                profile: report.profile,
                startedAt: report.startedAt,
                maxRuntimeMs: report.maxRuntimeMs,
              },
              output,
            );
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};

export const traceExportCommandSpec: NetworkCommandSpec = {
  id: exportMeta.id,
  usage: exportMeta.usage,
  summary: exportMeta.summary,
  register: (ctx) => {
    ensureTraceCommand(ctx.target)
      .command("export")
      .description(exportMeta.summary)
      .argument("[targetId]", "Target handle for live capture export (omit when using --trace-id)")
      .requiredOption("--out <path>", "Artifact output path")
      .option("--trace-id <id>", "Existing trace handle from trace begin")
      .option("--profile <preset>", "Capture profile: custom|api|page|ws|perf", "perf")
      .option("--capture-ms <ms>", "Live capture duration in milliseconds", String(DEFAULT_TARGET_NETWORK_CAPTURE_MS))
      .option("--format <format>", "Artifact format: json|json.gz")
      .option("--timeout-ms <ms>", "Connection/stop timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .action(
        async (
          targetId: string | undefined,
          options: {
            out: string;
            traceId?: string;
            profile?: string;
            captureMs: string;
            format?: string;
            timeoutMs: number;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          try {
            const report = await targetTraceExport({
              timeoutMs: options.timeoutMs,
              outPath: options.out,
              traceId: options.traceId,
              targetId,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              profile: options.profile,
              captureMs: Number.parseInt(options.captureMs, 10),
              format: options.format,
            });
            ctx.printTargetSuccess(report, output);
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};

export const traceInsightCommandSpec: NetworkCommandSpec = {
  id: insightMeta.id,
  usage: insightMeta.usage,
  summary: insightMeta.summary,
  register: (ctx) => {
    ensureTraceCommand(ctx.target)
      .command("insight")
      .description(insightMeta.summary)
      .argument("[targetId]", "Target handle for live capture analysis")
      .option("--trace-id <id>", "Existing trace handle from trace begin")
      .option("--artifact-id <id>", "Artifact id source for offline analysis")
      .option("--profile <preset>", "Capture profile: custom|api|page|ws|perf", "perf")
      .option("--capture-ms <ms>", "Live capture duration in milliseconds", String(DEFAULT_TARGET_NETWORK_CAPTURE_MS))
      .option("--timeout-ms <ms>", "Connection/stop timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .action(
        async (
          targetId: string | undefined,
          options: {
            traceId?: string;
            artifactId?: string;
            profile?: string;
            captureMs: string;
            timeoutMs: number;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          try {
            const report = await targetTraceInsight({
              timeoutMs: options.timeoutMs,
              traceId: options.traceId,
              artifactId: options.artifactId,
              targetId,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              profile: options.profile,
              captureMs: Number.parseInt(options.captureMs, 10),
            });
            ctx.printTargetSuccess(report, output);
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};
