import { type Command } from "commander";
import {
  targetNetwork,
  targetNetworkArtifactList,
  targetNetworkCaptureBegin,
  targetNetworkCaptureEnd,
  targetNetworkExport,
} from "./core/usecases.js";
import {
  DEFAULT_TARGET_NETWORK_CAPTURE_MS,
  DEFAULT_TARGET_NETWORK_MAX_REQUESTS,
  DEFAULT_TARGET_NETWORK_MAX_RUNTIME_MS,
  DEFAULT_TARGET_NETWORK_MAX_WEBSOCKETS,
  DEFAULT_TARGET_NETWORK_MAX_WS_MESSAGES,
  DEFAULT_TARGET_TIMEOUT_MS,
} from "./core/types.js";

type OutputOpts = {
  json: boolean;
  pretty: boolean;
};

export function registerNetworkCommands(opts: {
  target: Command;
  program: Command;
  parseTimeoutMs: (input: string) => number;
  globalOutputOpts: () => OutputOpts;
  handleFailure: (error: unknown, outputOpts: OutputOpts) => void;
  printTargetSuccess: (report: unknown, output: OutputOpts) => void;
}) {
  opts.target
    .command("network")
    .description("Capture bounded network + websocket diagnostics and performance summary")
    .argument("<targetId>", "Target handle returned by open/target list")
    .option("--profile <preset>", "Preset capture profile: custom|api|page|ws|perf")
    .option("--view <mode>", "Projection mode: raw|summary|table", "raw")
    .option("--fields <csv>", "Comma-separated fields for table view")
    .option("--capture-ms <ms>", "Capture duration in milliseconds", String(DEFAULT_TARGET_NETWORK_CAPTURE_MS))
    .option("--max-requests <n>", "Maximum request records to retain", String(DEFAULT_TARGET_NETWORK_MAX_REQUESTS))
    .option("--max-websockets <n>", "Maximum websocket records to retain", String(DEFAULT_TARGET_NETWORK_MAX_WEBSOCKETS))
    .option(
      "--max-ws-messages <n>",
      "Maximum websocket frame previews to retain across all sockets",
      String(DEFAULT_TARGET_NETWORK_MAX_WS_MESSAGES),
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
    .option("--timeout-ms <ms>", "Connection/reload timeout in milliseconds", opts.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
    .action(
      async (
        targetId: string,
        options: {
          profile?: string;
          view?: string;
          fields?: string;
          captureMs: string;
          maxRequests: string;
          maxWebsockets: string;
          maxWsMessages: string;
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
        const output = opts.globalOutputOpts();
        const globalOpts = opts.program.opts<{ session?: string }>();
        const captureMs = Number.parseInt(options.captureMs, 10);
        const maxRequests = Number.parseInt(options.maxRequests, 10);
        const maxWebSockets = Number.parseInt(options.maxWebsockets, 10);
        const maxWsMessages = Number.parseInt(options.maxWsMessages, 10);
        try {
          const report = await targetNetwork({
            targetId,
            timeoutMs: options.timeoutMs,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
            profile: options.profile,
            view: options.view,
            fields: options.fields,
            captureMs,
            maxRequests,
            maxWebSockets,
            maxWsMessages,
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
          opts.printTargetSuccess(report, output);
        } catch (error) {
          opts.handleFailure(error, output);
        }
      },
    );

  opts.target
    .command("network-export")
    .description("Export filtered network capture as HAR artifact")
    .argument("<targetId>", "Target handle returned by open/target list")
    .requiredOption("--out <path>", "Artifact output path")
    .option("--format <format>", "Artifact format (har)", "har")
    .option("--profile <preset>", "Preset capture profile: custom|api|page|ws|perf")
    .option("--capture-ms <ms>", "Capture duration in milliseconds", String(DEFAULT_TARGET_NETWORK_CAPTURE_MS))
    .option("--max-requests <n>", "Maximum request records to retain", String(DEFAULT_TARGET_NETWORK_MAX_REQUESTS))
    .option("--url-contains <text>", "Only include requests whose URL contains text")
    .option("--method <verb>", "Only include requests with this HTTP verb (e.g. GET)")
    .option("--resource-type <type>", "Only include requests with this Playwright resource type")
    .option("--status <codeOrClass>", "Only include requests matching status code (200) or class (2xx)")
    .option("--failed-only", "Only include failed requests")
    .option("--reload", "Reload page before capture to observe startup requests")
    .option("--timeout-ms <ms>", "Connection/reload timeout in milliseconds", opts.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
    .action(
      async (
        targetId: string,
        options: {
          out: string;
          format: string;
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
        const output = opts.globalOutputOpts();
        const globalOpts = opts.program.opts<{ session?: string }>();
        const captureMs = Number.parseInt(options.captureMs, 10);
        const maxRequests = Number.parseInt(options.maxRequests, 10);
        try {
          const report = await targetNetworkExport({
            targetId,
            timeoutMs: options.timeoutMs,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
            outPath: options.out,
            format: options.format,
            profile: options.profile,
            captureMs,
            maxRequests,
            urlContains: options.urlContains,
            method: options.method,
            resourceType: options.resourceType,
            status: options.status,
            failedOnly: Boolean(options.failedOnly),
            reload: Boolean(options.reload),
          });
          opts.printTargetSuccess(report, output);
        } catch (error) {
          opts.handleFailure(error, output);
        }
      },
    );

  opts.target
    .command("network-begin")
    .description("Start background network capture and return capture handle")
    .argument("<targetId>", "Target handle returned by open/target list")
    .option("--profile <preset>", "Preset capture profile: custom|api|page|ws|perf")
    .option("--max-runtime-ms <ms>", "Maximum recorder runtime in milliseconds", String(DEFAULT_TARGET_NETWORK_MAX_RUNTIME_MS))
    .option("--max-requests <n>", "Maximum request records to retain", String(DEFAULT_TARGET_NETWORK_MAX_REQUESTS))
    .option("--max-websockets <n>", "Maximum websocket records to retain", String(DEFAULT_TARGET_NETWORK_MAX_WEBSOCKETS))
    .option(
      "--max-ws-messages <n>",
      "Maximum websocket frame previews to retain across all sockets",
      String(DEFAULT_TARGET_NETWORK_MAX_WS_MESSAGES),
    )
    .option("--include-headers", "Include request/response headers in recorder")
    .option("--include-post-data", "Include bounded request post-data preview in recorder")
    .option("--no-ws-messages", "Disable websocket frame preview capture in recorder")
    .option("--timeout-ms <ms>", "Connection timeout in milliseconds", opts.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
    .action(
      async (
        targetId: string,
        options: {
          profile?: string;
          maxRuntimeMs: string;
          maxRequests: string;
          maxWebsockets: string;
          maxWsMessages: string;
          includeHeaders?: boolean;
          includePostData?: boolean;
          wsMessages?: boolean;
          timeoutMs: number;
        },
      ) => {
        const output = opts.globalOutputOpts();
        const globalOpts = opts.program.opts<{ session?: string }>();
        try {
          const report = await targetNetworkCaptureBegin({
            targetId,
            timeoutMs: options.timeoutMs,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
            profile: options.profile,
            maxRuntimeMs: Number.parseInt(options.maxRuntimeMs, 10),
            maxRequests: Number.parseInt(options.maxRequests, 10),
            maxWebSockets: Number.parseInt(options.maxWebsockets, 10),
            maxWsMessages: Number.parseInt(options.maxWsMessages, 10),
            includeHeaders: Boolean(options.includeHeaders),
            includePostData: Boolean(options.includePostData),
            includeWsMessages: options.wsMessages !== false,
          });
          opts.printTargetSuccess(report, output);
        } catch (error) {
          opts.handleFailure(error, output);
        }
      },
    );

  opts.target
    .command("network-end")
    .description("Stop background capture by handle and return projected analysis")
    .argument("<captureId>", "Capture handle from network-begin")
    .option("--profile <preset>", "Projection profile: custom|api|page|ws|perf")
    .option("--view <mode>", "Projection mode: raw|summary|table", "raw")
    .option("--fields <csv>", "Comma-separated fields for table view")
    .option("--url-contains <text>", "Filter requests/websockets URL by substring")
    .option("--method <verb>", "Filter requests by method")
    .option("--resource-type <type>", "Filter requests by resource type")
    .option("--status <codeOrClass>", "Filter requests by status code/class")
    .option("--failed-only", "Only return failed requests")
    .option("--timeout-ms <ms>", "Stop wait timeout in milliseconds", opts.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
    .action(
      async (
        captureId: string,
        options: {
          profile?: string;
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
        const output = opts.globalOutputOpts();
        try {
          const report = await targetNetworkCaptureEnd({
            captureId,
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
          opts.printTargetSuccess(report, output);
        } catch (error) {
          opts.handleFailure(error, output);
        }
      },
    );

  opts.target
    .command("network-export-list")
    .description("List indexed network export artifacts")
    .option("--limit <n>", "Maximum artifacts to return", "50")
    .action((options: { limit: string }) => {
      const output = opts.globalOutputOpts();
      try {
        const report = targetNetworkArtifactList({
          limit: Number.parseInt(options.limit, 10),
        });
        opts.printTargetSuccess(report, output);
      } catch (error) {
        opts.handleFailure(error, output);
      }
    });
}
