import { targetNetworkCaptureBegin } from "../../../core/network/public.js";
import {
  DEFAULT_TARGET_NETWORK_MAX_REQUESTS,
  DEFAULT_TARGET_NETWORK_MAX_RUNTIME_MS,
  DEFAULT_TARGET_NETWORK_MAX_WEBSOCKETS,
  DEFAULT_TARGET_NETWORK_MAX_WS_MESSAGES,
  DEFAULT_TARGET_TIMEOUT_MS,
} from "../../../core/types.js";
import { networkCommandMeta } from "../manifest.js";
import type { NetworkCommandSpec } from "./types.js";

const meta = networkCommandMeta("target.network-begin");

export const networkBeginCommandSpec: NetworkCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("network-begin")
      .description("Start background network capture and return capture handle")
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--action-id <id>", "Correlation action id for this capture window")
      .option("--profile <preset>", "Preset capture profile: custom|api|page|ws|perf")
      .option("--max-runtime-ms <ms>", "Maximum recorder runtime in milliseconds", String(DEFAULT_TARGET_NETWORK_MAX_RUNTIME_MS))
      .option("--max-requests <n>", "Maximum request records to retain", String(DEFAULT_TARGET_NETWORK_MAX_REQUESTS))
      .option("--max-websockets <n>", "Maximum websocket records to retain", String(DEFAULT_TARGET_NETWORK_MAX_WEBSOCKETS))
      .option(
        "--max-ws-messages <n>",
        "Maximum websocket frame previews to retain across all sockets",
        String(DEFAULT_TARGET_NETWORK_MAX_WS_MESSAGES),
      )
      .option("--body-sample-bytes <n>", "Maximum bytes to sample for post-data preview", "512")
      .option(
        "--redact-regex <pattern>",
        "Redact matching substrings in headers/post-data preview (repeatable)",
        (value, prev) => {
          const next = Array.isArray(prev) ? prev : [];
          next.push(value);
          return next;
        },
        [] as string[],
      )
      .option("--include-headers", "Include request/response headers in recorder")
      .option("--include-post-data", "Include bounded request post-data preview in recorder")
      .option("--no-ws-messages", "Disable websocket frame preview capture in recorder")
      .option("--timeout-ms <ms>", "Connection timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .action(
        async (
          targetId: string,
          options: {
            actionId?: string;
            profile?: string;
            maxRuntimeMs: string;
            maxRequests: string;
            maxWebsockets: string;
            maxWsMessages: string;
            bodySampleBytes: string;
            redactRegex: string[];
            includeHeaders?: boolean;
            includePostData?: boolean;
            wsMessages?: boolean;
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
              maxRequests: Number.parseInt(options.maxRequests, 10),
              maxWebSockets: Number.parseInt(options.maxWebsockets, 10),
              maxWsMessages: Number.parseInt(options.maxWsMessages, 10),
              bodySampleBytes: Number.parseInt(options.bodySampleBytes, 10),
              redactRegex: options.redactRegex,
              includeHeaders: Boolean(options.includeHeaders),
              includePostData: Boolean(options.includePostData),
              includeWsMessages: options.wsMessages !== false,
            });
            ctx.printTargetSuccess(report, output);
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};
