import { targetNetworkCaptureEnd } from "../../../core/network/public.js";
import { networkCommandMeta } from "../manifest.js";
import type { NetworkCommandSpec } from "./types.js";

const meta = networkCommandMeta("target.network-end");
const DEFAULT_NETWORK_END_TIMEOUT_MS = 20000;

export const networkEndCommandSpec: NetworkCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
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
      .option("--timeout-ms <ms>", "Stop wait timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_NETWORK_END_TIMEOUT_MS)
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
          const output = ctx.globalOutputOpts();
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
            ctx.printTargetSuccess(report, output);
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};
