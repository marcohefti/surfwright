export type DaemonLaneKey = string;

export type DaemonSchedulerTask<T> = {
  laneKey: DaemonLaneKey;
  execute: () => Promise<T>;
};

export interface DaemonScheduler<T> {
  enqueue(task: DaemonSchedulerTask<T>): Promise<T>;
}

export type DaemonRuntimeLease<T> = {
  runtime: T;
  release: () => Promise<void>;
};

export type DaemonRuntimeAcquireInput = {
  laneKey: DaemonLaneKey;
};

export interface DaemonRuntimePool<T> {
  acquire(input: DaemonRuntimeAcquireInput): Promise<DaemonRuntimeLease<T>>;
}
