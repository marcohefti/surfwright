export type DaemonDiagnosticsEvent = {
  ts: string;
  event: string;
  requestId: string;
  sessionId: string;
  command: string;
  result: "success" | "typed_error" | "unreachable" | "timeout" | "cancelled";
  errorCode: string | null;
  queueScope: string;
  queueWaitMs: number;
  durationMs: number;
};

export type DaemonDiagnosticsMetric = {
  ts: string;
  metric: string;
  value: number;
  tags?: Record<string, string>;
};

export interface DaemonDiagnostics {
  emitEvent(event: DaemonDiagnosticsEvent): void;
  emitMetric(metric: DaemonDiagnosticsMetric): void;
}

export function createNoopDaemonDiagnostics(): DaemonDiagnostics {
  return {
    emitEvent: () => {
      // no-op by contract
    },
    emitMetric: () => {
      // no-op by contract
    },
  };
}
