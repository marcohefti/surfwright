import { allocateCaptureId, readState, updateState } from "../infra/state-store.js";
import type { SurfwrightState, TargetNetworkCaptureStatus } from "../../types.js";

type NetworkCaptureState = SurfwrightState["networkCaptures"][string];

export async function createNetworkCapture(input: {
  sessionId: string;
  targetId: string;
  startedAt: string;
  profile: "custom" | "api" | "page" | "ws" | "perf";
  maxRuntimeMs: number;
  pathsForCaptureId: (captureId: string) => {
    stopSignalPath: string;
    donePath: string;
    resultPath: string;
  };
  actionId: string;
}): Promise<NetworkCaptureState> {
  return await updateState((state) => {
    const captureId = allocateCaptureId(state);
    const paths = input.pathsForCaptureId(captureId);
    const record: NetworkCaptureState = {
      captureId,
      sessionId: input.sessionId,
      targetId: input.targetId,
      startedAt: input.startedAt,
      status: "recording",
      profile: input.profile,
      maxRuntimeMs: input.maxRuntimeMs,
      workerPid: null,
      stopSignalPath: paths.stopSignalPath,
      donePath: paths.donePath,
      resultPath: paths.resultPath,
      endedAt: null,
      actionId: input.actionId,
    };
    state.networkCaptures[captureId] = record;
    return record;
  });
}

export async function readNetworkCapture(captureId: string): Promise<NetworkCaptureState | null> {
  const state = readState();
  const record = state.networkCaptures[captureId];
  return record ? { ...record } : null;
}

export async function setNetworkCaptureWorkerPid(captureId: string, workerPid: number | null) {
  await updateState((state) => {
    const record = state.networkCaptures[captureId];
    if (!record) {
      return;
    }
    record.workerPid = workerPid;
  });
}

export async function finalizeNetworkCapture(opts: {
  captureId: string;
  status: TargetNetworkCaptureStatus;
  endedAt: string;
}) {
  await updateState((state) => {
    const record = state.networkCaptures[opts.captureId];
    if (!record) {
      return;
    }
    record.status = opts.status;
    record.endedAt = opts.endedAt;
    record.workerPid = null;
  });
}

export async function deleteNetworkCapture(captureId: string) {
  await updateState((state) => {
    delete state.networkCaptures[captureId];
  });
}
