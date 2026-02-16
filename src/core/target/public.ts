import { CliError } from "../errors.js";

export function queryInvalid(message: string): CliError {
  return new CliError("E_QUERY_INVALID", message);
}

export { parseFieldsCsv, projectReportFields } from "../report-fields.js";

export { targetClick, targetFill, targetSpawn } from "./infra/target-click.js";
export { targetClose, targetEval } from "./infra/target-eval.js";
export { targetClickAt, targetEmulate, targetScreenshot } from "./infra/target-emulation.js";
export { targetExtract } from "./infra/target-extract.js";
export { targetDragDrop, targetFind, targetUpload } from "./infra/target-find.js";
export { targetConsoleGet, targetConsoleTail, targetHealth, targetHud } from "./infra/target-observability.js";
export { targetFormFill, targetRead } from "./infra/target-read.js";
export { targetDialog, targetKeypress, targetWait } from "./infra/target-wait.js";
export { targetList } from "./infra/targets.js";
export { targetSnapshot } from "./snapshot/target-snapshot.js";
export { readPageTargetId, resolveSessionForAction } from "./infra/targets.js";
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
} from "./infra/network/index.js";
