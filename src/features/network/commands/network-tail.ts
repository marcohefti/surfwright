import { targetNetworkTail } from "../../../core/usecases.js";
import {
  DEFAULT_TARGET_NETWORK_CAPTURE_MS,
  DEFAULT_TARGET_NETWORK_MAX_WS_MESSAGES,
  DEFAULT_TARGET_TIMEOUT_MS,
} from "../../../core/types.js";
import { networkCommandMeta } from "../manifest.js";
import type { NetworkCommandSpec } from "./types.js";
import { writeNdjson } from "./types.js";

const meta = networkCommandMeta("target.network-tail");

export const networkTailCommandSpec: NetworkCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("network-tail")
      .description("Stream live network/websocket events as NDJSON")
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--action-id <id>", "Correlation action id to stamp on emitted events")
      .option("--profile <preset>", "Preset capture profile: custom|api|page|ws|perf")
      .option("--capture-ms <ms>", "Capture duration in milliseconds", String(DEFAULT_TARGET_NETWORK_CAPTURE_MS))
      .option("--max-ws-messages <n>", "Maximum websocket frame events to emit", String(DEFAULT_TARGET_NETWORK_MAX_WS_MESSAGES))
      .option("--url-contains <text>", "Only emit URLs containing text")
      .option("--method <verb>", "Only emit requests with this HTTP verb")
      .option("--resource-type <type>", "Only emit requests with this Playwright resource type")
      .option("--status <codeOrClass>", "Only emit request end events matching status code/class")
      .option("--failed-only", "Only emit failed requests")
      .option("--reload", "Reload page before streaming")
      .option("--timeout-ms <ms>", "Connection/reload timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
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
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
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
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};
