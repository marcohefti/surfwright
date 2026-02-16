import { targetNetworkExport } from "../../../core/network/public.js";
import {
  DEFAULT_TARGET_NETWORK_CAPTURE_MS,
  DEFAULT_TARGET_NETWORK_MAX_REQUESTS,
  DEFAULT_TARGET_TIMEOUT_MS,
} from "../../../core/types.js";
import { networkCommandMeta } from "../manifest.js";
import type { NetworkCommandSpec } from "./types.js";

const meta = networkCommandMeta("target.network-export");

export const networkExportCommandSpec: NetworkCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("network-export")
      .description("Export filtered network capture as HAR artifact")
      .argument("<targetId>", "Target handle returned by open/target list")
      .requiredOption("--out <path>", "Artifact output path")
      .option("--format <format>", "Artifact format (har)", "har")
      .option("--action-id <id>", "Correlation action id to stamp on captured events")
      .option("--profile <preset>", "Preset capture profile: custom|api|page|ws|perf")
      .option("--capture-ms <ms>", "Capture duration in milliseconds", String(DEFAULT_TARGET_NETWORK_CAPTURE_MS))
      .option("--max-requests <n>", "Maximum request records to retain", String(DEFAULT_TARGET_NETWORK_MAX_REQUESTS))
      .option("--url-contains <text>", "Only include requests whose URL contains text")
      .option("--method <verb>", "Only include requests with this HTTP verb (e.g. GET)")
      .option("--resource-type <type>", "Only include requests with this Playwright resource type")
      .option("--status <codeOrClass>", "Only include requests matching status code (200) or class (2xx)")
      .option("--failed-only", "Only include failed requests")
      .option("--reload", "Reload page before capture to observe startup requests")
      .option("--timeout-ms <ms>", "Connection/reload timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .action(
        async (
          targetId: string,
          options: {
            out: string;
            format: string;
            actionId?: string;
            profile?: string;
            captureMs: string;
            maxRequests: string;
            urlContains?: string;
            method?: string;
            resourceType?: string;
            status?: string;
            failedOnly?: boolean;
            reload?: boolean;
            timeoutMs: number;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          try {
            const report = await targetNetworkExport({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              outPath: options.out,
              format: options.format,
              actionId: options.actionId,
              profile: options.profile,
              captureMs: Number.parseInt(options.captureMs, 10),
              maxRequests: Number.parseInt(options.maxRequests, 10),
              urlContains: options.urlContains,
              method: options.method,
              resourceType: options.resourceType,
              status: options.status,
              failedOnly: Boolean(options.failedOnly),
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
