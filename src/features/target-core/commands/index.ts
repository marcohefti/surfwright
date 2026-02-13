import { targetClickCommandSpec } from "./target-click.js";
import { targetFindCommandSpec } from "./target-find.js";
import { targetListCommandSpec } from "./target-list.js";
import { targetPruneCommandSpec } from "./target-prune.js";
import { targetReadCommandSpec } from "./target-read.js";
import { targetSnapshotCommandSpec } from "./target-snapshot.js";
import { targetWaitCommandSpec } from "./target-wait.js";
import type { TargetCommandSpec } from "./types.js";

export const targetCommandSpecs: TargetCommandSpec[] = [
  targetListCommandSpec,
  targetSnapshotCommandSpec,
  targetFindCommandSpec,
  targetClickCommandSpec,
  targetReadCommandSpec,
  targetWaitCommandSpec,
  targetPruneCommandSpec,
];
