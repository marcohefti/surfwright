import { type Command } from "commander";
import { targetFind, targetList, targetRead, targetSnapshot, targetWait } from "./core/usecases.js";
import {
  DEFAULT_TARGET_FIND_LIMIT,
  DEFAULT_TARGET_READ_CHUNK_SIZE,
  DEFAULT_TARGET_TIMEOUT_MS,
  type TargetFindReport,
  type TargetListReport,
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
  report: TargetListReport | TargetSnapshotReport | TargetFindReport | TargetReadReport | TargetWaitReport,
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
}
