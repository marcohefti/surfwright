import type { NetworkCommandSpec } from "./types.js";
import { networkBeginCommandSpec } from "./network-begin.js";
import { networkCheckCommandSpec } from "./network-check.js";
import { networkEndCommandSpec } from "./network-end.js";
import { networkExportCommandSpec } from "./network-export.js";
import { networkExportListCommandSpec } from "./network-export-list.js";
import { networkExportPruneCommandSpec } from "./network-export-prune.js";
import { networkQueryCommandSpec } from "./network-query.js";
import { networkTailCommandSpec } from "./network-tail.js";
import { networkCommandSpec } from "./network.js";

export const networkCommandSpecs: NetworkCommandSpec[] = [
  networkCommandSpec,
  networkTailCommandSpec,
  networkQueryCommandSpec,
  networkExportCommandSpec,
  networkExportListCommandSpec,
  networkExportPruneCommandSpec,
  networkBeginCommandSpec,
  networkEndCommandSpec,
  networkCheckCommandSpec,
];
