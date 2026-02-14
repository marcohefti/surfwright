import {
  targetClickCommandSpec,
  targetClickAtCommandSpec,
  targetCloseCommandSpec,
  targetDialogCommandSpec,
  targetDragDropCommandSpec,
  targetFillCommandSpec,
  targetKeypressCommandSpec,
  targetSpawnCommandSpec,
  targetUploadCommandSpec,
} from "./target-click.js";
import {
  targetObserveCommandSpec,
  targetScrollPlanCommandSpec,
  targetScrollSampleCommandSpec,
  targetScrollWatchCommandSpec,
  targetTransitionTraceCommandSpec,
} from "./effects/target-effects.js";
import {
  targetHoverCommandSpec,
  targetMotionDetectCommandSpec,
  targetScrollRevealScanCommandSpec,
  targetStickyCheckCommandSpec,
  targetTransitionAssertCommandSpec,
} from "./effects/target-effect-assertions.js";
import { targetEvalCommandSpec } from "./target-eval.js";
import { targetFindCommandSpec } from "./target-find.js";
import { targetFramesCommandSpec } from "./frames/target-frames.js";
import { targetListCommandSpec } from "./target-list.js";
import { targetConsoleGetCommandSpec, targetConsoleTailCommandSpec, targetHealthCommandSpec, targetHudCommandSpec } from "./target-observability.js";
import { targetPruneCommandSpec } from "./target-prune.js";
import { targetReadCommandSpec } from "./target-read.js";
import { targetSnapshotCommandSpec } from "./target-snapshot.js";
import {
  targetEmulateCommandSpec,
  targetExtractCommandSpec,
  targetFormFillCommandSpec,
  targetScreenshotCommandSpec,
} from "./target-structured.js";
import { targetWaitCommandSpec } from "./target-wait.js";
import { targetUrlAssertCommandSpec } from "./url/target-url-assert.js";
import type { TargetCommandSpec } from "./types.js";

export const targetCommandSpecs: TargetCommandSpec[] = [
  targetListCommandSpec,
  targetFramesCommandSpec,
  targetSnapshotCommandSpec,
  targetFindCommandSpec,
  targetClickCommandSpec,
  targetClickAtCommandSpec,
  targetFillCommandSpec,
  targetUploadCommandSpec,
  targetKeypressCommandSpec,
  targetDragDropCommandSpec,
  targetSpawnCommandSpec,
  targetCloseCommandSpec,
  targetDialogCommandSpec,
  targetFormFillCommandSpec,
  targetEmulateCommandSpec,
  targetScreenshotCommandSpec,
  targetHoverCommandSpec,
  targetStickyCheckCommandSpec,
  targetMotionDetectCommandSpec,
  targetObserveCommandSpec,
  targetScrollPlanCommandSpec,
  targetScrollSampleCommandSpec,
  targetScrollWatchCommandSpec,
  targetScrollRevealScanCommandSpec,
  targetTransitionAssertCommandSpec,
  targetTransitionTraceCommandSpec,
  targetEvalCommandSpec,
  targetReadCommandSpec,
  targetExtractCommandSpec,
  targetWaitCommandSpec,
  targetUrlAssertCommandSpec,
  targetConsoleGetCommandSpec,
  targetConsoleTailCommandSpec,
  targetHealthCommandSpec,
  targetHudCommandSpec,
  targetPruneCommandSpec,
];
