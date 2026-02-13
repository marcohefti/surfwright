import { targetClickCommandSpec } from "./target-click.js";
import {
  targetObserveCommandSpec,
  targetScrollPlanCommandSpec,
  targetScrollSampleCommandSpec,
  targetScrollWatchCommandSpec,
  targetTransitionTraceCommandSpec,
} from "./effects/target-effects.js";
import { targetEvalCommandSpec } from "./target-eval.js";
import { targetFindCommandSpec } from "./target-find.js";
import { targetListCommandSpec } from "./target-list.js";
import { targetConsoleTailCommandSpec, targetHealthCommandSpec, targetHudCommandSpec } from "./target-observability.js";
import { targetPruneCommandSpec } from "./target-prune.js";
import { targetReadCommandSpec } from "./target-read.js";
import { targetSnapshotCommandSpec } from "./target-snapshot.js";
import { targetExtractCommandSpec } from "./target-structured.js";
import { targetWaitCommandSpec } from "./target-wait.js";
import type { TargetCommandSpec } from "./types.js";

export const targetCommandSpecs: TargetCommandSpec[] = [
  targetListCommandSpec,
  targetSnapshotCommandSpec,
  targetFindCommandSpec,
  targetClickCommandSpec,
  targetObserveCommandSpec,
  targetScrollPlanCommandSpec,
  targetScrollSampleCommandSpec,
  targetScrollWatchCommandSpec,
  targetTransitionTraceCommandSpec,
  targetEvalCommandSpec,
  targetReadCommandSpec,
  targetExtractCommandSpec,
  targetWaitCommandSpec,
  targetConsoleTailCommandSpec,
  targetHealthCommandSpec,
  targetHudCommandSpec,
  targetPruneCommandSpec,
];
