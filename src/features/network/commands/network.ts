import { targetNetwork } from "../../../core/network/public.js";
import {
  DEFAULT_TARGET_NETWORK_CAPTURE_MS,
  DEFAULT_TARGET_NETWORK_MAX_REQUESTS,
  DEFAULT_TARGET_NETWORK_MAX_WEBSOCKETS,
  DEFAULT_TARGET_NETWORK_MAX_WS_MESSAGES,
  DEFAULT_TARGET_TIMEOUT_MS,
} from "../../../core/types.js";
import { networkCommandMeta } from "../manifest.js";
import type { NetworkCommandSpec } from "./types.js";

const meta = networkCommandMeta("target.network");

export const networkCommandSpec: NetworkCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("network")
      .description("Capture bounded network + websocket diagnostics and performance summary")
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--profile <preset>", "Preset capture profile: custom|api|page|ws|perf")
      .option("--action-id <id>", "Correlation action id to stamp on captured events")
      .option("--view <mode>", "Projection mode: raw|summary|table", "raw")
      .option("--fields <csv>", "Comma-separated fields for table view")
      .option("--capture-ms <ms>", "Capture duration in milliseconds", String(DEFAULT_TARGET_NETWORK_CAPTURE_MS))
      .option("--max-requests <n>", "Maximum request records to retain", String(DEFAULT_TARGET_NETWORK_MAX_REQUESTS))
      .option(
        "--max-websockets <n>",
        "Maximum websocket records to retain",
        String(DEFAULT_TARGET_NETWORK_MAX_WEBSOCKETS),
      )
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
      .option("--url-contains <text>", "Only return requests/websockets whose URL contains text")
      .option("--method <verb>", "Only return requests with this HTTP verb (e.g. GET)")
      .option("--resource-type <type>", "Only return requests with this Playwright resource type")
      .option("--status <codeOrClass>", "Only return requests matching status code (200) or class (2xx)")
      .option("--failed-only", "Only return failed requests")
      .option("--include-headers", "Include request/response headers (bounded by max item limits)")
      .option("--include-post-data", "Include bounded request post-data preview")
      .option("--no-ws-messages", "Disable websocket frame preview capture")
      .option("--reload", "Reload page before capture to observe startup requests")
      .option("--timeout-ms <ms>", "Connection/reload timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .action(
        async (
          targetId: string,
          options: {
            profile?: string;
            actionId?: string;
            view?: string;
            fields?: string;
            captureMs: string;
            maxRequests: string;
            maxWebsockets: string;
            maxWsMessages: string;
            bodySampleBytes: string;
            redactRegex: string[];
            urlContains?: string;
            method?: string;
            resourceType?: string;
            status?: string;
            failedOnly?: boolean;
            includeHeaders?: boolean;
            includePostData?: boolean;
            wsMessages?: boolean;
            reload?: boolean;
            timeoutMs: number;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          try {
            const report = await targetNetwork({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              profile: options.profile,
              actionId: options.actionId,
              view: options.view,
              fields: options.fields,
              captureMs: Number.parseInt(options.captureMs, 10),
              maxRequests: Number.parseInt(options.maxRequests, 10),
              maxWebSockets: Number.parseInt(options.maxWebsockets, 10),
              maxWsMessages: Number.parseInt(options.maxWsMessages, 10),
              bodySampleBytes: Number.parseInt(options.bodySampleBytes, 10),
              redactRegex: options.redactRegex,
              urlContains: options.urlContains,
              method: options.method,
              resourceType: options.resourceType,
              status: options.status,
              failedOnly: Boolean(options.failedOnly),
              includeHeaders: Boolean(options.includeHeaders),
              includePostData: Boolean(options.includePostData),
              includeWsMessages: options.wsMessages !== false,
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
