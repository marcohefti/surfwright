import { targetNetworkCaptureBegin, targetNetworkCaptureEnd } from "../../../../core/network/public.js";
import { targetClick } from "../../../../core/target/public.js";
import {
  DEFAULT_TARGET_NETWORK_MAX_REQUESTS,
  DEFAULT_TARGET_NETWORK_MAX_RUNTIME_MS,
  DEFAULT_TARGET_NETWORK_MAX_WEBSOCKETS,
  DEFAULT_TARGET_NETWORK_MAX_WS_MESSAGES,
  DEFAULT_TARGET_TIMEOUT_MS,
} from "../../../../core/types.js";
import { networkCommandMeta } from "../../manifest.js";
import type { NetworkCommandSpec } from "../types.js";

const meta = networkCommandMeta("target.network-around");

export const networkAroundCommandSpec: NetworkCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("network-around")
      .description("Capture network around a deterministic click (begin -> click -> end)")
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--click-text <query>", "Click query text (mutually exclusive with --click-selector)")
      .option("--click-selector <query>", "Click query selector (mutually exclusive with --click-text)")
      .option("--contains <text>", "Additional contains text filter for click query")
      .option("--visible-only", "Only consider visible click matches", false)
      .option("--index <n>", "Click match index (default picks first visible match)", (value) => Number.parseInt(value, 10))
      .option("--wait-for-text <text>", "Wait for visible text after click")
      .option("--wait-for-selector <query>", "Wait for visible selector after click")
      .option("--wait-network-idle", "Wait for network idle after click", false)
      .option("--snapshot", "Include bounded post-click snapshot preview in click report", false)
      .option("--delta", "Include bounded evidence-based delta after click", false)
      .option("--frame-scope <scope>", "Frame scope: main|all (default main)")
      .option("--action-id <id>", "Correlation action id for this capture window")
      .option("--profile <preset>", "Preset capture profile: custom|api|page|ws|perf")
      .option("--max-runtime-ms <ms>", "Maximum recorder runtime in milliseconds", String(DEFAULT_TARGET_NETWORK_MAX_RUNTIME_MS))
      .option("--max-requests <n>", "Maximum request records to retain", String(DEFAULT_TARGET_NETWORK_MAX_REQUESTS))
      .option("--max-websockets <n>", "Maximum websocket records to retain", String(DEFAULT_TARGET_NETWORK_MAX_WEBSOCKETS))
      .option("--max-ws-messages <n>", "Maximum websocket frame previews to retain across all sockets", String(DEFAULT_TARGET_NETWORK_MAX_WS_MESSAGES))
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
      .option("--view <mode>", "Projection mode: raw|summary|table", "summary")
      .option("--fields <csv>", "Comma-separated fields for table view")
      .option("--url-contains <text>", "Filter requests/websockets URL by substring")
      .option("--method <verb>", "Filter requests by method")
      .option("--resource-type <type>", "Filter requests by resource type")
      .option("--status <codeOrClass>", "Filter requests by status code/class")
      .option("--failed-only", "Only return failed requests")
      .option("--timeout-ms <ms>", "Connection timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .action(
        async (
          targetId: string,
          options: {
            clickText?: string;
            clickSelector?: string;
            contains?: string;
            visibleOnly?: boolean;
            index?: number;
            waitForText?: string;
            waitForSelector?: string;
            waitNetworkIdle?: boolean;
            snapshot?: boolean;
            delta?: boolean;
            frameScope?: string;
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
            view?: string;
            fields?: string;
            urlContains?: string;
            method?: string;
            resourceType?: string;
            status?: string;
            failedOnly?: boolean;
            timeoutMs: number;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const sessionId = typeof globalOpts.session === "string" ? globalOpts.session : undefined;
          try {
            const begin = await targetNetworkCaptureBegin({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId,
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

            const clickReport = await targetClick({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId,
              textQuery: options.clickText,
              selectorQuery: options.clickSelector,
              containsQuery: options.contains,
              visibleOnly: Boolean(options.visibleOnly),
              frameScope: options.frameScope,
              index: typeof options.index === "number" ? options.index : undefined,
              waitForText: options.waitForText,
              waitForSelector: options.waitForSelector,
              waitNetworkIdle: Boolean(options.waitNetworkIdle),
              snapshot: Boolean(options.snapshot),
              delta: Boolean(options.delta),
              persistState: true,
            });

            const end = await targetNetworkCaptureEnd({
              captureId: begin.captureId,
              timeoutMs: options.timeoutMs,
              profile: options.profile,
              view: options.view,
              fields: options.fields,
              urlContains: options.urlContains,
              method: options.method,
              resourceType: options.resourceType,
              status: options.status,
              failedOnly: Boolean(options.failedOnly),
            });

            ctx.printTargetSuccess(
              {
                ok: true,
                sessionId: begin.sessionId,
                sessionSource: begin.sessionSource,
                targetId: begin.targetId,
                captureId: begin.captureId,
                actionId: begin.actionId,
                click: clickReport,
                network: end,
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
