import { CliError } from "../errors.js";

export function queryInvalid(message: string): CliError {
  return new CliError("E_QUERY_INVALID", message);
}

export { parseFieldsCsv, projectReportFields } from "../report-fields.js";

export { targetClick, targetFill, targetSpawn } from "./target-click.js";
export { targetClose, targetEval } from "./target-eval.js";
export { targetClickAt, targetEmulate, targetScreenshot } from "./target-emulation.js";
export { targetExtract } from "./target-extract.js";
export { targetDragDrop, targetFind, targetUpload } from "./target-find.js";
export { targetConsoleGet, targetConsoleTail, targetHealth, targetHud } from "./target-observability.js";
export { targetFormFill, targetRead } from "./target-read.js";
export { targetDialog, targetKeypress, targetWait } from "./target-wait.js";
export { targetList } from "./targets.js";
export { targetSnapshot } from "./snapshot/target-snapshot.js";
export { readPageTargetId, resolveSessionForAction } from "./targets.js";
export { targetFrames } from "./frames/target-frames.js";
export { targetUrlAssert } from "./url/url-assert.js";

export { targetObserve } from "./effects/target-observe.js";
export { targetHover, targetMotionDetect, targetStickyCheck } from "./effects/target-effect-assertions.js";
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
} from "./network/index.js";
