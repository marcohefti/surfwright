import { isDaemonQueueError, resolveDaemonLaneKey, type DaemonLaneResolution } from "../domain/index.js";

type DaemonWorkerRunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type DaemonWorkerRequest =
  | {
      token: string;
      kind: "ping";
    }
  | {
      token: string;
      kind: "shutdown";
    }
  | {
      token: string;
      kind: "run";
      argv: string[];
    };

export type DaemonWorkerResponse =
  | {
      ok: true;
      kind: "pong";
    }
  | {
      ok: true;
      kind: "shutdown";
    }
  | {
      ok: true;
      kind: "run";
      code: number;
      stdout: string;
      stderr: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
      retryable?: boolean;
      phase?: string;
      recovery?: {
        strategy: string;
        nextCommand?: string;
        requiredFields?: string[];
        context?: Record<string, string | number | boolean | null>;
      };
      hints?: string[];
      hintContext?: Record<string, string | number | boolean | null>;
    };

export type DaemonWorkerOrchestratedResponse = {
  response: DaemonWorkerResponse;
  shutdownAfterWrite: boolean;
  scheduleIdleAfterWrite: boolean;
};

export async function orchestrateDaemonWorkerRequest(opts: {
  rawRequestLine: string;
  expectedToken: string;
  onRun: (argv: string[], lane: DaemonLaneResolution) => Promise<DaemonWorkerRunResult>;
}): Promise<DaemonWorkerOrchestratedResponse> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(opts.rawRequestLine);
  } catch {
    return {
      response: {
        ok: false,
        code: "E_DAEMON_REQUEST_INVALID",
        message: "request must be JSON",
      },
      shutdownAfterWrite: false,
      scheduleIdleAfterWrite: false,
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return {
      response: {
        ok: false,
        code: "E_DAEMON_REQUEST_INVALID",
        message: "request payload must be object",
      },
      shutdownAfterWrite: false,
      scheduleIdleAfterWrite: false,
    };
  }

  const request = parsed as Partial<DaemonWorkerRequest>;
  if (request.token !== opts.expectedToken) {
    return {
      response: {
        ok: false,
        code: "E_DAEMON_TOKEN_INVALID",
        message: "token mismatch",
      },
      shutdownAfterWrite: false,
      scheduleIdleAfterWrite: false,
    };
  }

  if (request.kind === "ping") {
    return {
      response: {
        ok: true,
        kind: "pong",
      },
      shutdownAfterWrite: false,
      scheduleIdleAfterWrite: true,
    };
  }

  if (request.kind === "shutdown") {
    return {
      response: {
        ok: true,
        kind: "shutdown",
      },
      shutdownAfterWrite: true,
      scheduleIdleAfterWrite: false,
    };
  }

  if (request.kind === "run") {
    if (!Array.isArray(request.argv) || request.argv.some((entry) => typeof entry !== "string")) {
      return {
        response: {
          ok: false,
          code: "E_DAEMON_REQUEST_INVALID",
          message: "run request requires argv string array",
        },
        shutdownAfterWrite: false,
        scheduleIdleAfterWrite: false,
      };
    }

    try {
      const lane = resolveDaemonLaneKey({ argv: request.argv });
      const result = await opts.onRun(request.argv, lane);
      return {
        response: {
          ok: true,
          kind: "run",
          code: result.code,
          stdout: result.stdout,
          stderr: result.stderr,
        },
        shutdownAfterWrite: false,
        scheduleIdleAfterWrite: true,
      };
    } catch (error) {
      if (isDaemonQueueError(error)) {
        const queueScope = error.laneKey ?? resolveDaemonLaneKey({ argv: request.argv }).laneKey;
        const queueWaitMs = typeof error.queueWaitMs === "number" ? error.queueWaitMs : null;
        const retryAfterMs = typeof error.retryAfterMs === "number" ? error.retryAfterMs : null;
        return {
          response: {
            ok: false,
            code: error.code,
            message: error.message,
            retryable: true,
            phase: "daemon_queue",
            recovery: {
              strategy: "retry-after-backoff",
              nextCommand: "surfwright <same-command>",
              requiredFields: ["queueScope", "retryAfterMs"],
              context: {
                queueScope,
                retryAfterMs,
              },
            },
            hints: [
              "Retry the same command after a short backoff",
              "Reduce parallel commands sharing the same session/profile/agent lane",
              "If continuity is required while diagnosing daemon load, retry with SURFWRIGHT_DAEMON=0",
            ],
            hintContext: {
              queueScope,
              queueWaitMs,
              queueDepth: error.queueDepth ?? null,
              laneQueueDepth: error.laneQueueDepth ?? null,
              retryAfterMs,
            },
          },
          shutdownAfterWrite: false,
          scheduleIdleAfterWrite: true,
        };
      }
      return {
        response: {
          ok: false,
          code: "E_DAEMON_RUN_FAILED",
          message: "daemon failed to execute command",
        },
        shutdownAfterWrite: false,
        scheduleIdleAfterWrite: true,
      };
    }
  }

  return {
    response: {
      ok: false,
      code: "E_DAEMON_REQUEST_INVALID",
      message: "unsupported request kind",
    },
    shutdownAfterWrite: false,
    scheduleIdleAfterWrite: false,
  };
}
