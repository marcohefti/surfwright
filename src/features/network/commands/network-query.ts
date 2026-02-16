import { targetNetworkQuery } from "../../../core/network/public.js";
import { networkCommandMeta } from "../manifest.js";
import type { NetworkCommandSpec } from "./types.js";

const meta = networkCommandMeta("target.network-query");

export const networkQueryCommandSpec: NetworkCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
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
          const output = ctx.globalOutputOpts();
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
            ctx.printTargetSuccess(report, output);
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};
