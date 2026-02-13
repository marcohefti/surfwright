import { type Command } from "commander";
import { targetFind, targetList, targetNetwork, targetPrune, targetRead, targetSnapshot, targetWait } from "./core/usecases.js";
import {
  DEFAULT_TARGET_FIND_LIMIT,
  DEFAULT_TARGET_NETWORK_CAPTURE_MS,
  DEFAULT_TARGET_NETWORK_MAX_REQUESTS,
  DEFAULT_TARGET_NETWORK_MAX_WEBSOCKETS,
  DEFAULT_TARGET_NETWORK_MAX_WS_MESSAGES,
  DEFAULT_TARGET_READ_CHUNK_SIZE,
  DEFAULT_TARGET_TIMEOUT_MS,
  type TargetFindReport,
  type TargetListReport,
  type TargetNetworkReport,
  type TargetPruneReport,
  type TargetReadReport,
  type TargetSnapshotReport,
  type TargetWaitReport,
} from "./core/types.js";

export type TargetOutputOpts = {
  json: boolean;
  pretty: boolean;
};

function writeJson(value: unknown, opts: { pretty: boolean }) {
  process.stdout.write(`${JSON.stringify(value, null, opts.pretty ? 2 : 0)}\n`);
}

function printTargetSuccess(
  report:
    | TargetListReport
    | TargetSnapshotReport
    | TargetFindReport
    | TargetReadReport
    | TargetWaitReport
    | TargetNetworkReport
    | TargetPruneReport,
  opts: TargetOutputOpts,
) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }

  if ("targets" in report) {
    process.stdout.write(`ok sessionId=${report.sessionId} targets=${report.targets.length}\n`);
    return;
  }

  if ("matches" in report) {
    process.stdout.write(
      [
        "ok",
        `sessionId=${report.sessionId}`,
        `targetId=${report.targetId}`,
        `mode=${report.mode}`,
        `count=${report.count}`,
        `returned=${report.matches.length}`,
      ].join(" ") + "\n",
    );
    return;
  }

  if ("chunkIndex" in report) {
    process.stdout.write(
      [
        "ok",
        `sessionId=${report.sessionId}`,
        `targetId=${report.targetId}`,
        `chunk=${report.chunkIndex}/${report.totalChunks}`,
        `chars=${report.text.length}`,
      ].join(" ") + "\n",
    );
    return;
  }

  if ("value" in report) {
    process.stdout.write(
      [
        "ok",
        `sessionId=${report.sessionId}`,
        `targetId=${report.targetId}`,
        `mode=${report.mode}`,
        `value=${report.value ?? "null"}`,
      ].join(" ") + "\n",
    );
    return;
  }

  if ("capture" in report) {
    const harParts = report.har
      ? [`har=${report.har.path}`, `harEntries=${report.har.entries}`, `harBytes=${report.har.bytes}`]
      : [];
    process.stdout.write(
      [
        "ok",
        `sessionId=${report.sessionId}`,
        `targetId=${report.targetId}`,
        `requests=${report.counts.requestsReturned}`,
        `responses=${report.counts.responsesSeen}`,
        `failed=${report.counts.failedSeen}`,
        `websockets=${report.counts.webSocketsReturned}`,
        ...harParts,
      ].join(" ") + "\n",
    );
    return;
  }

  if ("removedOrphaned" in report) {
    process.stdout.write(
      [
        "ok",
        `activeSessionId=${report.activeSessionId ?? "none"}`,
        `scanned=${report.scanned}`,
        `remaining=${report.remaining}`,
        `removed=${report.removed}`,
      ].join(" ") + "\n",
    );
    return;
  }

  process.stdout.write(
    ["ok", `sessionId=${report.sessionId}`, `targetId=${report.targetId}`, `url=${report.url}`].join(" ") + "\n",
  );
}

export function registerTargetCommands(opts: {
  program: Command;
  parseTimeoutMs: (input: string) => number;
  globalOutputOpts: () => TargetOutputOpts;
  handleFailure: (error: unknown, outputOpts: TargetOutputOpts) => void;
}) {
  const target = opts.program.command("target").description("Inspect browser targets in a session");

  target
    .command("list")
    .description("List current page targets with explicit handles")
    .option("--timeout-ms <ms>", "Target listing timeout in milliseconds", opts.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
    .action(async (options: { timeoutMs: number }) => {
      const output = opts.globalOutputOpts();
      const globalOpts = opts.program.opts<{ session?: string }>();
      try {
        const report = await targetList({
          timeoutMs: options.timeoutMs,
          sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
        });
        printTargetSuccess(report, output);
      } catch (error) {
        opts.handleFailure(error, output);
      }
    });

  target
    .command("snapshot")
    .description("Read bounded text and UI primitives for a target")
    .argument("<targetId>", "Target handle returned by open/target list")
    .option("--selector <query>", "Scope snapshot to a selector")
    .option("--visible-only", "Only include visible content")
    .option("--max-chars <n>", "Maximum text preview chars to return")
    .option("--max-headings <n>", "Maximum heading rows to return")
    .option("--max-buttons <n>", "Maximum button rows to return")
    .option("--max-links <n>", "Maximum link rows to return")
    .option("--timeout-ms <ms>", "Snapshot timeout in milliseconds", opts.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
    .action(
      async (
        targetId: string,
        options: {
          selector?: string;
          visibleOnly?: boolean;
          maxChars?: string;
          maxHeadings?: string;
          maxButtons?: string;
          maxLinks?: string;
          timeoutMs: number;
        },
      ) => {
        const output = opts.globalOutputOpts();
        const globalOpts = opts.program.opts<{ session?: string }>();
        const maxChars = typeof options.maxChars === "string" ? Number.parseInt(options.maxChars, 10) : undefined;
        const maxHeadings =
          typeof options.maxHeadings === "string" ? Number.parseInt(options.maxHeadings, 10) : undefined;
        const maxButtons =
          typeof options.maxButtons === "string" ? Number.parseInt(options.maxButtons, 10) : undefined;
        const maxLinks = typeof options.maxLinks === "string" ? Number.parseInt(options.maxLinks, 10) : undefined;
        try {
          const report = await targetSnapshot({
            targetId,
            timeoutMs: options.timeoutMs,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
            selectorQuery: options.selector,
            visibleOnly: Boolean(options.visibleOnly),
            maxChars,
            maxHeadings,
            maxButtons,
            maxLinks,
          });
          printTargetSuccess(report, output);
        } catch (error) {
          opts.handleFailure(error, output);
        }
      },
    );

  target
    .command("find")
    .description("Find elements by text or selector in a target")
    .argument("<targetId>", "Target handle returned by open/target list")
    .option("--text <query>", "Text query for fuzzy text match")
    .option("--selector <query>", "CSS/Playwright selector query")
    .option("--contains <text>", "Text filter to apply with --selector")
    .option("--visible-only", "Only return visible matches")
    .option("--first", "Return at most the first actionable match")
    .option("--limit <n>", "Maximum matches to return", String(DEFAULT_TARGET_FIND_LIMIT))
    .option("--timeout-ms <ms>", "Find timeout in milliseconds", opts.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
    .action(
      async (
        targetId: string,
        options: {
          text?: string;
          selector?: string;
          contains?: string;
          visibleOnly?: boolean;
          first?: boolean;
          limit: string;
          timeoutMs: number;
        },
      ) => {
        const output = opts.globalOutputOpts();
        const globalOpts = opts.program.opts<{ session?: string }>();
        const parsedLimit = Number.parseInt(options.limit, 10);
        try {
          const report = await targetFind({
            targetId,
            timeoutMs: options.timeoutMs,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
            textQuery: options.text,
            selectorQuery: options.selector,
            containsQuery: options.contains,
            visibleOnly: Boolean(options.visibleOnly),
            first: Boolean(options.first),
            limit: parsedLimit,
          });
          printTargetSuccess(report, output);
        } catch (error) {
          opts.handleFailure(error, output);
        }
      },
    );

  target
    .command("read")
    .description("Read target text in deterministic chunks")
    .argument("<targetId>", "Target handle returned by open/target list")
    .option("--selector <query>", "Scope read to a selector")
    .option("--visible-only", "Only include visible text")
    .option("--chunk-size <n>", "Chunk size in characters", String(DEFAULT_TARGET_READ_CHUNK_SIZE))
    .option("--chunk <n>", "Chunk index to read (1-based)", "1")
    .option("--timeout-ms <ms>", "Read timeout in milliseconds", opts.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
    .action(
      async (
        targetId: string,
        options: { selector?: string; visibleOnly?: boolean; chunkSize: string; chunk: string; timeoutMs: number },
      ) => {
        const output = opts.globalOutputOpts();
        const globalOpts = opts.program.opts<{ session?: string }>();
        const chunkSize = Number.parseInt(options.chunkSize, 10);
        const chunkIndex = Number.parseInt(options.chunk, 10);
        try {
          const report = await targetRead({
            targetId,
            timeoutMs: options.timeoutMs,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
            selectorQuery: options.selector,
            visibleOnly: Boolean(options.visibleOnly),
            chunkSize,
            chunkIndex,
          });
          printTargetSuccess(report, output);
        } catch (error) {
          opts.handleFailure(error, output);
        }
      },
    );

  target
    .command("wait")
    .description("Wait for text, selector, or network idle on a target")
    .argument("<targetId>", "Target handle returned by open/target list")
    .option("--for-text <text>", "Wait until text becomes visible")
    .option("--for-selector <query>", "Wait until selector becomes visible")
    .option("--network-idle", "Wait for network idle state")
    .option("--timeout-ms <ms>", "Wait timeout in milliseconds", opts.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
    .action(
      async (
        targetId: string,
        options: { forText?: string; forSelector?: string; networkIdle?: boolean; timeoutMs: number },
      ) => {
        const output = opts.globalOutputOpts();
        const globalOpts = opts.program.opts<{ session?: string }>();
        try {
          const report = await targetWait({
            targetId,
            timeoutMs: options.timeoutMs,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
            forText: options.forText,
            forSelector: options.forSelector,
            networkIdle: Boolean(options.networkIdle),
          });
          printTargetSuccess(report, output);
        } catch (error) {
          opts.handleFailure(error, output);
        }
      },
    );

  target
    .command("network")
    .description("Capture bounded network + websocket diagnostics and performance summary")
    .argument("<targetId>", "Target handle returned by open/target list")
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
    .option("--har-out <path>", "Write filtered capture as HAR artifact (compact minimal mode)")
    .option("--reload", "Reload page before capture to observe startup requests")
    .option("--timeout-ms <ms>", "Connection/reload timeout in milliseconds", opts.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
    .action(
      async (
        targetId: string,
        options: {
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
          harOut?: string;
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
            harOut: options.harOut,
            reload: Boolean(options.reload),
          });
          printTargetSuccess(report, output);
        } catch (error) {
          opts.handleFailure(error, output);
        }
      },
    );

  target
    .command("prune")
    .description("Prune stale/orphan target metadata with age and size caps")
    .option("--max-age-hours <h>", "Maximum target age in hours to retain")
    .option("--max-per-session <n>", "Maximum retained targets per session")
    .action(async (options: { maxAgeHours?: string; maxPerSession?: string }) => {
      const output = opts.globalOutputOpts();
      const maxAgeHours = typeof options.maxAgeHours === "string" ? Number.parseInt(options.maxAgeHours, 10) : undefined;
      const maxPerSession =
        typeof options.maxPerSession === "string" ? Number.parseInt(options.maxPerSession, 10) : undefined;
      try {
        const report = await targetPrune({
          maxAgeHours,
          maxPerSession,
        });
        printTargetSuccess(report, output);
      } catch (error) {
        opts.handleFailure(error, output);
      }
    });
}
