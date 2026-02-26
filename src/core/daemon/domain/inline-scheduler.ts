import type { DaemonScheduler, DaemonSchedulerTask } from "./contracts.js";

export function createInlineDaemonScheduler<T>(): DaemonScheduler<T> {
  return {
    enqueue: async (task: DaemonSchedulerTask<T>) => await task.execute(),
  };
}
