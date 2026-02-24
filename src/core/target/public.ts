import { CliError } from "../errors.js";

export function queryInvalid(message: string): CliError {
  return new CliError("E_QUERY_INVALID", message);
}

export { parseFieldsCsv, projectReportFields } from "../report-fields.js";

export { targetClick, targetFill, targetSpawn } from "./infra/target-click.js";
export { targetDownload } from "./infra/actions/target-download.js";
export { targetClose, targetEval } from "./infra/target-eval.js";
export { targetClickAt, targetEmulate, targetScreenshot } from "./infra/target-emulation.js";
export { targetAttr } from "./infra/query/target-attr.js";
export { targetCount } from "./infra/query/target-count.js";
export { targetExtract } from "./infra/target-extract.js";
export { targetFind } from "./infra/target-find.js";
export { targetDragDrop } from "./infra/actions/target-drag-drop.js";
export { targetUpload } from "./infra/actions/target-upload.js";
export { targetSelectOption } from "./infra/actions/target-select-option.js";
export { targetConsoleGet, targetConsoleTail, targetHealth, targetHud } from "./infra/target-observability.js";
export { targetFormFill, targetRead } from "./infra/target-read.js";
export { targetWait } from "./infra/target-wait.js";
export { targetDialog } from "./infra/actions/target-dialog.js";
export { targetKeypress } from "./infra/actions/target-keypress.js";
export { targetList } from "./infra/targets.js";
export { targetSnapshot } from "./snapshot/target-snapshot.js";
export { targetSnapshotDiffFromFiles } from "./infra/utils/target-snapshot-diff.js";
export { readPageTargetId, resolveSessionForAction } from "./infra/targets.js";
export { targetFrames } from "./frames/target-frames.js";
export { targetUrlAssert } from "./url/url-assert.js";

export { targetObserve } from "./effects/target-observe.js";
export { targetHover, targetMotionDetect, targetStickyCheck } from "./effects/target-effect-assertions.js";
export { targetStyle } from "./effects/target-style.js";
export { targetScrollRevealScan, targetTransitionAssert } from "./effects/target-effect-assertions-advanced.js";
export { targetScrollPlan } from "./effects/target-scroll-plan.js";
export { targetScrollSample } from "./effects/target-scroll-sample.js";
export { targetScrollWatch } from "./effects/target-scroll-watch.js";
export { targetTransitionTrace } from "./effects/target-transition-trace.js";
export { sessionCookieCopy } from "./effects/session-cookie-copy.js";

export { targetPrune } from "../state/index.js";

export {
  parseWorkerArgv,
  runTargetNetworkWorker,
  targetNetwork,
  targetNetworkArtifactList,
  targetNetworkArtifactPrune,
  targetNetworkCaptureBegin,
  targetNetworkCaptureEnd,
  targetNetworkCheck,
  targetNetworkExport,
  targetNetworkQuery,
  targetNetworkTail,
  targetTraceExport,
  targetTraceInsight,
  writeHarFile,
} from "./infra/network/index.js";
