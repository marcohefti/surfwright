import { stateRootDir } from "../../state/index.js";
import { providers } from "../../providers/index.js";
import type { DaemonDiagnostics, DaemonDiagnosticsEvent, DaemonDiagnosticsMetric } from "../domain/index.js";

const DIAGNOSTICS_DIR = "diagnostics";
const EVENTS_FILENAME = "daemon.ndjson";
const METRICS_FILENAME = "daemon.metrics.ndjson";

function diagnosticsDirPath(): string {
  return providers().path.join(stateRootDir(), DIAGNOSTICS_DIR);
}

function eventsPath(): string {
  return providers().path.join(diagnosticsDirPath(), EVENTS_FILENAME);
}

function metricsPath(): string {
  return providers().path.join(diagnosticsDirPath(), METRICS_FILENAME);
}

function debugEnabled(): boolean {
  return providers().env.get("SURFWRIGHT_DEBUG_LOGS") === "1";
}

function safeSessionId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "none") {
    return "none";
  }
  const digest = providers().crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, 12);
  return `sid:${digest}`;
}

function safeQueueScope(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("session:")) {
    const rawSession = trimmed.slice("session:".length);
    return `session:${safeSessionId(rawSession)}`;
  }
  return trimmed;
}

function appendNdjson(filePath: string, payload: unknown): void {
  try {
    providers().fs.mkdirSync(diagnosticsDirPath(), { recursive: true });
    providers().fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
  } catch {
    // diagnostics writes are best-effort and must never fail command path
  }
}

export function createLocalDaemonDiagnostics(): DaemonDiagnostics {
  return {
    emitEvent(event: DaemonDiagnosticsEvent): void {
      if (!debugEnabled()) {
        return;
      }
      appendNdjson(eventsPath(), {
        ts: event.ts,
        event: event.event,
        requestId: event.requestId,
        sessionId: safeSessionId(event.sessionId),
        command: event.command,
        result: event.result,
        errorCode: event.errorCode,
        queueScope: safeQueueScope(event.queueScope),
        queueWaitMs: event.queueWaitMs,
        durationMs: event.durationMs,
      });
    },
    emitMetric(metric: DaemonDiagnosticsMetric): void {
      appendNdjson(metricsPath(), {
        ts: metric.ts,
        metric: metric.metric,
        value: metric.value,
        ...(metric.tags ? { tags: metric.tags } : {}),
      });
    },
  };
}
