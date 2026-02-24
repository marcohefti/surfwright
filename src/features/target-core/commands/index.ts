import {
  targetClickCommandSpec,
  targetClickAtCommandSpec,
} from "./target-click.js";
import {
  targetClickReadCommandSpec,
  targetDragDropCommandSpec,
  targetFillCommandSpec,
  targetKeypressCommandSpec,
} from "./actions/target-interaction-commands.js";
import { targetUploadCommandSpec } from "./actions/target-upload-command.js";
import { targetSelectOptionCommandSpec } from "./actions/target-select-option.js";
import { targetCloseCommandSpec, targetDialogCommandSpec, targetSpawnCommandSpec } from "./actions/target-window.js";
import { targetDownloadCommandSpec } from "./actions/target-download.js";
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
  targetStyleCommandSpec,
  targetTransitionAssertCommandSpec,
} from "./effects/target-effect-assertions.js";
import { targetEvalCommandSpec } from "./target-eval.js";
import { targetFindCommandSpec } from "./target-find.js";
import { targetAttrCommandSpec } from "./query/target-attr.js";
import { targetCountCommandSpec } from "./query/target-count.js";
import { targetFramesCommandSpec } from "./frames/target-frames.js";
import { targetListCommandSpec } from "./target-list.js";
import { targetConsoleGetCommandSpec, targetConsoleTailCommandSpec, targetHealthCommandSpec, targetHudCommandSpec } from "./target-observability.js";
import { targetPruneCommandSpec } from "./target-prune.js";
import { targetReadCommandSpec } from "./target-read.js";
import { targetSnapshotCommandSpec } from "./target-snapshot.js";
import { targetSnapshotDiffCommandSpec } from "./snapshot/target-snapshot-diff.js";
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
  targetSnapshotDiffCommandSpec,
  targetAttrCommandSpec,
  targetCountCommandSpec,
  targetFindCommandSpec,
  targetClickCommandSpec,
  targetClickReadCommandSpec,
  targetDownloadCommandSpec,
  targetClickAtCommandSpec,
  targetFillCommandSpec,
  targetSelectOptionCommandSpec,
  targetUploadCommandSpec,
  targetKeypressCommandSpec,
  targetDragDropCommandSpec,
  targetSpawnCommandSpec,
  targetCloseCommandSpec,
  targetDialogCommandSpec,
  targetFormFillCommandSpec,
  targetEmulateCommandSpec,
  targetScreenshotCommandSpec,
  targetStyleCommandSpec,
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
