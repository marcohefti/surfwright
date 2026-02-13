import { type Command } from "commander";
import {
  targetNetwork,
  targetNetworkArtifactPrune,
  targetNetworkArtifactList,
  targetNetworkCaptureBegin,
  targetNetworkCaptureEnd,
  targetNetworkCheck,
  targetNetworkExport,
  targetNetworkQuery,
  targetNetworkTail,
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
function writeNdjson(event: unknown) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

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
    .option("--action-id <id>", "Correlation action id to stamp on captured events")
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
          actionId?: string;
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
            actionId: options.actionId,
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
    .option("--timeout-ms <ms>", "Connection/reload timeout in milliseconds", opts.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
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
            actionId: options.actionId,
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
    .option("--include-headers", "Include request/response headers in recorder")
    .option("--include-post-data", "Include bounded request post-data preview in recorder")
    .option("--no-ws-messages", "Disable websocket frame preview capture in recorder")
    .option("--timeout-ms <ms>", "Connection timeout in milliseconds", opts.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
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
            actionId: options.actionId,
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
    .command("network-tail")
    .description("Stream live network/websocket events as NDJSON")
    .argument("<targetId>", "Target handle returned by open/target list")
    .option("--action-id <id>", "Correlation action id to stamp on emitted events")
    .option("--profile <preset>", "Preset capture profile: custom|api|page|ws|perf")
    .option("--capture-ms <ms>", "Capture duration in milliseconds", String(DEFAULT_TARGET_NETWORK_CAPTURE_MS))
    .option(
      "--max-ws-messages <n>",
      "Maximum websocket frame events to emit",
      String(DEFAULT_TARGET_NETWORK_MAX_WS_MESSAGES),
    )
    .option("--url-contains <text>", "Only emit URLs containing text")
    .option("--method <verb>", "Only emit requests with this HTTP verb")
    .option("--resource-type <type>", "Only emit requests with this Playwright resource type")
    .option("--status <codeOrClass>", "Only emit request end events matching status code/class")
    .option("--failed-only", "Only emit failed requests")
    .option("--reload", "Reload page before streaming")
    .option("--timeout-ms <ms>", "Connection/reload timeout in milliseconds", opts.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
    .action(
      async (
        targetId: string,
        options: {
          actionId?: string;
          profile?: string;
          captureMs: string;
          maxWsMessages: string;
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
        try {
          const report = await targetNetworkTail({
            targetId,
            timeoutMs: options.timeoutMs,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
            actionId: options.actionId,
            profile: options.profile,
            captureMs: Number.parseInt(options.captureMs, 10),
            maxWsMessages: Number.parseInt(options.maxWsMessages, 10),
            urlContains: options.urlContains,
            method: options.method,
            resourceType: options.resourceType,
            status: options.status,
            failedOnly: Boolean(options.failedOnly),
            reload: Boolean(options.reload),
            onEvent: (event) => writeNdjson(event),
          });
          if (!output.json) {
            process.stdout.write(
              [
                "ok",
                `sessionId=${report.sessionId}`,
                `targetId=${report.targetId}`,
                `events=${report.eventCount}`,
                `requests=${report.counts.requests}`,
                `responses=${report.counts.responses}`,
              ].join(" ") + "\n",
            );
          }
        } catch (error) {
          opts.handleFailure(error, output);
        }
      },
    );

  opts.target
    .command("network-query")
    .description("Query saved network capture/artifact with high-signal presets")
    .option("--capture-id <id>", "Capture id source")
    .option("--artifact-id <id>", "Artifact id source")
    .option("--preset <name>", "Preset: summary|slowest|errors|largest|ws-hotspots", "summary")
    .option("--limit <n>", "Maximum rows to return", "20")
    .option("--url-contains <text>", "Filter URLs by substring")
    .option("--method <verb>", "Filter by method")
    .option("--resource-type <type>", "Filter by resource type")
    .option("--status <codeOrClass>", "Filter by status code/class")
    .option("--failed-only", "Only include failed requests")
    .action(
      (options: {
        captureId?: string;
        artifactId?: string;
        preset?: string;
        limit: string;
        urlContains?: string;
        method?: string;
        resourceType?: string;
        status?: string;
        failedOnly?: boolean;
      }) => {
        const output = opts.globalOutputOpts();
        try {
          const report = targetNetworkQuery({
            captureId: options.captureId,
            artifactId: options.artifactId,
            preset: options.preset,
            limit: Number.parseInt(options.limit, 10),
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

  opts.target
    .command("network-export-prune")
    .description("Prune export artifact index/files by retention policy")
    .option("--max-age-hours <h>", "Delete artifacts older than N hours")
    .option("--max-count <n>", "Keep at most N newest artifacts")
    .option("--max-total-mb <n>", "Keep artifacts within total size budget (MB)")
    .option("--keep-files", "Only prune state index, do not delete files")
    .action(
      async (options: { maxAgeHours?: string; maxCount?: string; maxTotalMb?: string; keepFiles?: boolean }) => {
        const output = opts.globalOutputOpts();
        try {
          const report = await targetNetworkArtifactPrune({
            maxAgeHours: typeof options.maxAgeHours === "string" ? Number.parseInt(options.maxAgeHours, 10) : undefined,
            maxCount: typeof options.maxCount === "string" ? Number.parseInt(options.maxCount, 10) : undefined,
            maxTotalBytes:
              typeof options.maxTotalMb === "string" ? Number.parseInt(options.maxTotalMb, 10) * 1024 * 1024 : undefined,
            deleteFiles: !options.keepFiles,
          });
          opts.printTargetSuccess(report, output);
        } catch (error) {
          opts.handleFailure(error, output);
        }
      },
    );

  opts.target
    .command("network-check")
    .description("Evaluate network metrics against a budget file")
    .argument("[targetId]", "Target handle for live capture mode")
    .requiredOption("--budget <path>", "Budget JSON file")
    .option("--capture-id <id>", "Check against saved capture id")
    .option("--artifact-id <id>", "Check against saved artifact id")
    .option("--profile <preset>", "Live capture profile: custom|api|page|ws|perf", "perf")
    .option("--capture-ms <ms>", "Live capture duration in milliseconds", String(DEFAULT_TARGET_NETWORK_CAPTURE_MS))
    .option("--fail-on-violation", "Exit non-zero when budget check fails")
    .option("--timeout-ms <ms>", "Connection/reload timeout in milliseconds", opts.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
    .action(
      async (
        targetId: string | undefined,
        options: {
          budget: string;
          captureId?: string;
          artifactId?: string;
          profile?: string;
          captureMs: string;
          failOnViolation?: boolean;
          timeoutMs: number;
        },
      ) => {
        const output = opts.globalOutputOpts();
        const globalOpts = opts.program.opts<{ session?: string }>();
        try {
          const report = await targetNetworkCheck({
            budgetPath: options.budget,
            targetId,
            timeoutMs: options.timeoutMs,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
            captureId: options.captureId,
            artifactId: options.artifactId,
            profile: options.profile,
            captureMs: Number.parseInt(options.captureMs, 10),
          });
          opts.printTargetSuccess(report, output);
          if (options.failOnViolation && !report.passed) {
            process.exitCode = 1;
          }
        } catch (error) {
          opts.handleFailure(error, output);
        }
      },
    );
}
