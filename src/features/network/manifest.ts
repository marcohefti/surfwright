import type { CliCommandContract } from "../../core/types.js";

export const networkCommandManifest: CliCommandContract[] = [
  {
    id: "target.network",
    usage:
      "surfwright target network <targetId> [--action-id <id>] [--profile <preset>] [--view <mode>] [--fields <csv>] [--capture-ms <ms>] [--max-requests <n>] [--max-websockets <n>] [--max-ws-messages <n>] [--body-sample-bytes <n>] [--redact-regex <pattern> ...] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--include-headers] [--include-post-data] [--no-ws-messages] [--reload] [--timeout-ms <ms>] [--no-json] [--pretty] [--session <id>]",
    summary: "capture bounded network/websocket diagnostics and performance summary for a target",
  },
  {
    id: "target.network-tail",
    usage:
      "surfwright target network-tail <targetId> [--action-id <id>] [--profile <preset>] [--capture-ms <ms>] [--max-events <n>] [--max-ws-messages <n>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--reload] [--timeout-ms <ms>] [--no-json] [--pretty] [--session <id>]",
    summary: "stream live network/websocket events as NDJSON for short capture windows",
  },
  {
    id: "target.network-query",
    usage:
      "surfwright target network-query [--capture-id <id> | --artifact-id <id>] [--preset <name>] [--limit <n>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--no-json] [--pretty]",
    summary: "query saved network captures/artifacts with high-signal presets",
  },
  {
    id: "target.network-export",
    usage:
      "surfwright target network-export <targetId> --out <path> [--action-id <id>] [--format har] [--profile <preset>] [--capture-ms <ms>] [--max-requests <n>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--reload] [--timeout-ms <ms>] [--no-json] [--pretty] [--session <id>]",
    summary: "export filtered network capture as artifact (har)",
  },
  {
    id: "target.network-export-list",
    usage: "surfwright target network-export-list [--limit <n>] [--no-json] [--pretty]",
    summary: "list indexed network export artifacts",
  },
  {
    id: "target.network-export-prune",
    usage:
      "surfwright target network-export-prune [--max-age-hours <h>] [--max-count <n>] [--max-total-mb <n>] [--keep-files] [--no-json] [--pretty]",
    summary: "prune indexed export artifacts by retention policy",
  },
  {
    id: "target.network-around",
    usage:
      "surfwright target network-around <targetId> (--click-text <query> | --click-selector <query>) [--contains <text>] [--visible-only] [--index <n>] [--wait-for-text <text> | --wait-for-selector <query> | --wait-network-idle] [--snapshot] [--delta] [--frame-scope <scope>] [--action-id <id>] [--profile <preset>] [--max-runtime-ms <ms>] [--max-requests <n>] [--max-websockets <n>] [--max-ws-messages <n>] [--body-sample-bytes <n>] [--redact-regex <pattern> ...] [--include-headers] [--include-post-data] [--no-ws-messages] [--view <mode>] [--fields <csv>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--timeout-ms <ms>] [--no-json] [--pretty] [--session <id>]",
    summary: "capture network around a deterministic click and return combined click + network report",
  },
  {
    id: "target.network-begin",
    usage:
      "surfwright target network-begin <targetId> [--action-id <id>] [--profile <preset>] [--max-runtime-ms <ms>] [--max-requests <n>] [--max-websockets <n>] [--max-ws-messages <n>] [--body-sample-bytes <n>] [--redact-regex <pattern> ...] [--include-headers] [--include-post-data] [--no-ws-messages] [--timeout-ms <ms>] [--no-json] [--pretty] [--session <id>]",
    summary: "start handle-based background network capture for an action window",
  },
  {
    id: "target.network-end",
    usage:
      "surfwright target network-end <captureId> [--profile <preset>] [--view <mode>] [--fields <csv>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--timeout-ms <ms>] [--no-json] [--pretty]",
    summary: "stop background capture handle and return projected analysis report",
  },
  {
    id: "target.trace.begin",
    usage:
      "surfwright target trace begin <targetId> [--action-id <id>] [--profile <preset>] [--max-runtime-ms <ms>] [--timeout-ms <ms>] [--no-json] [--pretty] [--session <id>]",
    summary: "start performance trace capture and return trace handle",
  },
  {
    id: "target.trace.export",
    usage:
      "surfwright target trace export [targetId] --out <path> [--trace-id <id>] [--profile <preset>] [--capture-ms <ms>] [--format <json|json.gz>] [--timeout-ms <ms>] [--no-json] [--pretty] [--session <id>]",
    summary: "export trace payload to json/json.gz from trace handle or live capture",
  },
  {
    id: "target.trace.insight",
    usage:
      "surfwright target trace insight [targetId] [--trace-id <id>] [--artifact-id <id>] [--profile <preset>] [--capture-ms <ms>] [--timeout-ms <ms>] [--no-json] [--pretty] [--session <id>]",
    summary: "return one bounded high-signal trace insight from capture/artifact/live source",
  },
  {
    id: "target.network-check",
    usage:
      "surfwright target network-check [targetId] --budget <path> [--capture-id <id>] [--artifact-id <id>] [--profile <preset>] [--capture-ms <ms>] [--fail-on-violation] [--timeout-ms <ms>] [--no-json] [--pretty] [--session <id>]",
    summary: "evaluate network metrics against budget thresholds",
  },
];

export function networkCommandMeta(id: string): CliCommandContract {
  const found = networkCommandManifest.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`missing network command manifest entry: ${id}`);
  }
  return found;
}
