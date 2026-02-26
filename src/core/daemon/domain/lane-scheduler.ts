import { createNoopDaemonDiagnostics, type DaemonDiagnostics } from "./diagnostics.js";

export const DAEMON_GLOBAL_ACTIVE_LANES_DEFAULT = 8;
export const DAEMON_LANE_QUEUE_DEPTH_DEFAULT = 8;
export const DAEMON_QUEUE_WAIT_MS_DEFAULT = 2000;

export class DaemonQueueError extends Error {
  code: "E_DAEMON_QUEUE_TIMEOUT" | "E_DAEMON_QUEUE_SATURATED";

  constructor(code: "E_DAEMON_QUEUE_TIMEOUT" | "E_DAEMON_QUEUE_SATURATED", message: string) {
    super(message);
    this.code = code;
    this.name = "DaemonQueueError";
  }
}

export function isDaemonQueueError(value: unknown): value is DaemonQueueError {
  return value instanceof DaemonQueueError;
}

type ScheduledTask<T> = {
  laneKey: string;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  timeout: NodeJS.Timeout;
  started: boolean;
};

type LaneState<T> = {
  active: boolean;
  queue: ScheduledTask<T>[];
};

export type DaemonLaneScheduler<T> = {
  enqueue: (input: { laneKey: string; execute: () => Promise<T> }) => Promise<T>;
};

export function createDaemonLaneScheduler<T>(opts?: {
  globalActiveLanes?: number;
  laneQueueDepth?: number;
  queueWaitMs?: number;
  diagnostics?: DaemonDiagnostics;
}): DaemonLaneScheduler<T> {
  const globalActiveLanes = opts?.globalActiveLanes ?? DAEMON_GLOBAL_ACTIVE_LANES_DEFAULT;
  const laneQueueDepth = opts?.laneQueueDepth ?? DAEMON_LANE_QUEUE_DEPTH_DEFAULT;
  const queueWaitMs = opts?.queueWaitMs ?? DAEMON_QUEUE_WAIT_MS_DEFAULT;
  const diagnostics = opts?.diagnostics ?? createNoopDaemonDiagnostics();

  const lanes = new Map<string, LaneState<T>>();
  let activeLaneCount = 0;
  let cursor = 0;
  let scheduling = false;

  const ensureLane = (laneKey: string): LaneState<T> => {
    const existing = lanes.get(laneKey);
    if (existing) {
      return existing;
    }
    const created: LaneState<T> = {
      active: false,
      queue: [],
    };
    lanes.set(laneKey, created);
    return created;
  };

  const compactLane = (laneKey: string): void => {
    const lane = lanes.get(laneKey);
    if (!lane) {
      return;
    }
    if (!lane.active && lane.queue.length === 0) {
      lanes.delete(laneKey);
      if (cursor >= lanes.size) {
        cursor = 0;
      }
    }
  };

  const nextRunnableLaneKey = (): string | null => {
    const laneKeys = Array.from(lanes.keys());
    if (laneKeys.length === 0) {
      return null;
    }
    const start = laneKeys.length === 0 ? 0 : cursor % laneKeys.length;
    for (let offset = 0; offset < laneKeys.length; offset += 1) {
      const index = (start + offset) % laneKeys.length;
      const laneKey = laneKeys[index];
      const lane = lanes.get(laneKey);
      if (!lane || lane.active || lane.queue.length === 0) {
        continue;
      }
      cursor = index + 1;
      return laneKey;
    }
    return null;
  };

  const schedule = (): void => {
    if (scheduling) {
      return;
    }
    scheduling = true;
    try {
      while (activeLaneCount < globalActiveLanes) {
        const laneKey = nextRunnableLaneKey();
        if (!laneKey) {
          break;
        }
        const lane = lanes.get(laneKey);
        if (!lane || lane.active) {
          continue;
        }
        const task = lane.queue.shift();
        if (!task) {
          compactLane(laneKey);
          continue;
        }
        task.started = true;
        clearTimeout(task.timeout);
        lane.active = true;
        activeLaneCount += 1;
        Promise.resolve()
          .then(task.execute)
          .then((value) => {
            task.resolve(value);
          })
          .catch((error) => {
            task.reject(error);
          })
          .finally(() => {
            lane.active = false;
            activeLaneCount = Math.max(0, activeLaneCount - 1);
            compactLane(laneKey);
            schedule();
          });
      }
    } finally {
      scheduling = false;
    }
  };

  const emitMetric = (metric: string, value: number, tags?: Record<string, string>) => {
    diagnostics.emitMetric({
      ts: new Date().toISOString(),
      metric,
      value,
      ...(tags ? { tags } : {}),
    });
  };

  return {
    enqueue: async (input: { laneKey: string; execute: () => Promise<T> }) => {
      const lane = ensureLane(input.laneKey);
      emitMetric("daemon_queue_depth", lane.queue.length, {
        scope: input.laneKey,
      });
      if (lane.queue.length >= laneQueueDepth) {
        emitMetric("daemon_queue_rejects_total", 1, {
          reason: "saturated",
          scope: input.laneKey,
        });
        throw new DaemonQueueError("E_DAEMON_QUEUE_SATURATED", "daemon lane queue depth exceeded");
      }
      return await new Promise<T>((resolve, reject) => {
        const task: ScheduledTask<T> = {
          laneKey: input.laneKey,
          execute: input.execute,
          resolve,
          reject,
          started: false,
          timeout: setTimeout(() => {
            if (task.started) {
              return;
            }
            const index = lane.queue.indexOf(task);
            if (index >= 0) {
              lane.queue.splice(index, 1);
            }
            emitMetric("daemon_queue_rejects_total", 1, {
              reason: "timeout",
              scope: input.laneKey,
            });
            compactLane(input.laneKey);
            reject(new DaemonQueueError("E_DAEMON_QUEUE_TIMEOUT", "daemon queue wait budget exceeded"));
            schedule();
          }, queueWaitMs),
        };
        lane.queue.push(task);
        schedule();
      });
    },
  };
}
