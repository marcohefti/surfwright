import { chromium } from "playwright-core";
import { newActionId, sanitizeActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso, stateRootDir } from "../../state/index.js";
import {
  createNetworkCapture,
  deleteNetworkCapture,
  finalizeNetworkCapture,
  readNetworkCapture,
  setNetworkCaptureWorkerPid,
} from "../../state/index.js";
import { targetNetwork } from "./target-network.js";
import { buildInsights, buildPerformanceSummary, buildTruncationHints, toTableRows } from "./target-network-analysis.js";
import {
  matchesRequestFilters,
  parseNetworkInput,
} from "./target-network-utils.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";
import { providers } from "../../providers/index.js";
import type {
  TargetNetworkCaptureBeginReport,
  TargetNetworkCaptureEndReport,
  TargetNetworkReport,
} from "../../types.js";

const CAPTURE_MAX_RUNTIME_MIN_MS = 1000;
const CAPTURE_MAX_RUNTIME_CAP_MS = 60 * 60 * 1000;

function captureDirPath(): string {
  return providers().path.join(stateRootDir(), "captures");
}

function parseCaptureId(input: string): string {
  const value = input.trim();
  if (!/^c-[0-9]+$/.test(value)) {
    throw new CliError("E_QUERY_INVALID", "captureId is invalid");
  }
  return value;
}

function parseMaxRuntimeMs(value: number | undefined): number {
  if (typeof value === "undefined") {
    return 10 * 60 * 1000;
  }
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < CAPTURE_MAX_RUNTIME_MIN_MS || value > CAPTURE_MAX_RUNTIME_CAP_MS) {
    throw new CliError(
      "E_QUERY_INVALID",
      `max-runtime-ms must be an integer between ${CAPTURE_MAX_RUNTIME_MIN_MS} and ${CAPTURE_MAX_RUNTIME_CAP_MS}`,
    );
  }
  return value;
}

async function ensureCaptureTargetExists(opts: { targetId: string; sessionId?: string; timeoutMs: number }) {
  const { session, sessionSource } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: sanitizeTargetId(opts.targetId),
  });
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  try {
    await resolveTargetHandle(browser, sanitizeTargetId(opts.targetId));
    return {
      sessionId: session.sessionId,
      sessionSource,
    };
  } finally {
    await browser.close();
  }
}

function parseNumberOrThrow(raw: string, name: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new CliError("E_QUERY_INVALID", `${name} must be an integer`);
  }
  return parsed;
}

export async function targetNetworkCaptureBegin(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  actionId?: string;
  profile?: string;
  maxRuntimeMs?: number;
  maxRequests?: number;
  maxWebSockets?: number;
  maxWsMessages?: number;
  includeHeaders?: boolean;
  includePostData?: boolean;
  includeWsMessages?: boolean;
}): Promise<TargetNetworkCaptureBeginReport> {
  const { childProcess, env, fs, path, runtime } = providers();
  const targetId = sanitizeTargetId(opts.targetId);
  const actionId =
    typeof opts.actionId === "string" && opts.actionId.trim().length > 0 ? sanitizeActionId(opts.actionId) : newActionId();
  const ensuredTarget = await ensureCaptureTargetExists({
    targetId,
    sessionId: opts.sessionId,
    timeoutMs: opts.timeoutMs,
  });
  const parsed = parseNetworkInput({
    profile: opts.profile,
    maxRequests: opts.maxRequests,
    maxWebSockets: opts.maxWebSockets,
    maxWsMessages: opts.maxWsMessages,
    includeHeaders: opts.includeHeaders,
    includePostData: opts.includePostData,
    includeWsMessages: opts.includeWsMessages,
  });
  const maxRuntimeMs = parseMaxRuntimeMs(opts.maxRuntimeMs);
  const startedAt = nowIso();
  const root = captureDirPath();
  fs.mkdirSync(root, { recursive: true });

  const captureRecord = await createNetworkCapture({
    sessionId: ensuredTarget.sessionId,
    targetId,
    startedAt,
    profile: parsed.profile,
    maxRuntimeMs,
    pathsForCaptureId: (captureId) => ({
      stopSignalPath: path.join(root, `${captureId}.stop`),
      donePath: path.join(root, `${captureId}.done.json`),
      resultPath: path.join(root, `${captureId}.result.json`),
    }),
    actionId,
  });

  for (const pathToRemove of [captureRecord.stopSignalPath, captureRecord.donePath, captureRecord.resultPath]) {
    try {
      fs.rmSync(pathToRemove, { force: true });
    } catch {
      // ignore
    }
  }

  const cliScript = runtime.argv[1];
  if (!cliScript) {
    throw new CliError("E_INTERNAL", "Unable to resolve CLI script path for recorder worker");
  }

  const child = childProcess.spawn(
    runtime.execPath,
    [
      cliScript,
      "__network-worker",
      "--capture-id",
      captureRecord.captureId,
      "--session-id",
      captureRecord.sessionId,
      "--target-id",
      captureRecord.targetId,
      "--result-path",
      captureRecord.resultPath,
      "--done-path",
      captureRecord.donePath,
      "--stop-path",
      captureRecord.stopSignalPath,
      "--max-runtime-ms",
      String(captureRecord.maxRuntimeMs),
      "--profile",
      parsed.profile,
      "--action-id",
      captureRecord.actionId,
      "--max-requests",
      String(parsed.maxRequests),
      "--max-websockets",
      String(parsed.maxWebSockets),
      "--max-ws-messages",
      String(parsed.maxWsMessages),
      "--include-headers",
      parsed.includeHeaders ? "1" : "0",
      "--include-post-data",
      parsed.includePostData ? "1" : "0",
      "--include-ws-messages",
      parsed.includeWsMessages ? "1" : "0",
    ],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...env.snapshot(),
        SURFWRIGHT_STATE_DIR: stateRootDir(),
      },
    },
  );
  child.unref();
  if (!child.pid || !Number.isFinite(child.pid)) {
    await deleteNetworkCapture(captureRecord.captureId);
    throw new CliError("E_INTERNAL", "Failed to start network capture worker");
  }
  await setNetworkCaptureWorkerPid(captureRecord.captureId, child.pid);

  return {
    ok: true,
    sessionId: captureRecord.sessionId,
    sessionSource: ensuredTarget.sessionSource,
    targetId: captureRecord.targetId,
    captureId: captureRecord.captureId,
    actionId: captureRecord.actionId,
    status: "recording",
    profile: captureRecord.profile,
    startedAt: captureRecord.startedAt,
    maxRuntimeMs: captureRecord.maxRuntimeMs,
  };
}

async function waitForCaptureDone(donePath: string, timeoutMs: number): Promise<{
  status: "stopped" | "failed";
  endedAt: string;
  message: string | null;
}> {
  const { fs } = providers();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(donePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(donePath, "utf8")) as {
          status?: unknown;
          endedAt?: unknown;
          message?: unknown;
        };
        return {
          status: parsed.status === "failed" ? "failed" : "stopped",
          endedAt: typeof parsed.endedAt === "string" ? parsed.endedAt : nowIso(),
          message: typeof parsed.message === "string" ? parsed.message : null,
        };
      } catch {
        return {
          status: "failed",
          endedAt: nowIso(),
          message: "invalid done payload",
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new CliError("E_WAIT_TIMEOUT", "Timed out waiting for capture worker to stop");
}

function applyCapturedView(raw: TargetNetworkReport, parsed: ReturnType<typeof parseNetworkInput>): TargetNetworkReport {
  const requests = raw.requests.filter((request) => matchesRequestFilters(request, parsed));
  const webSockets = parsed.urlContains ? raw.webSockets.filter((socket) => socket.url.includes(parsed.urlContains ?? "")) : raw.webSockets;
  const counts = {
    ...raw.counts,
    requestsReturned: requests.length,
    webSocketsReturned: webSockets.length,
    wsMessagesReturned: webSockets.reduce((acc, socket) => acc + socket.messages.length, 0),
  };
  return {
    ...raw,
    filters: {
      urlContains: parsed.urlContains,
      method: parsed.method,
      resourceType: parsed.resourceType,
      status: parsed.statusInput,
      failedOnly: parsed.failedOnly,
      profile: parsed.profile,
    },
    view: parsed.view,
    fields: parsed.fields,
    tableRows: parsed.view === "table" ? toTableRows(requests, parsed.fields) : [],
    counts,
    performance: buildPerformanceSummary(requests),
    hints: buildTruncationHints({
      droppedRequests: raw.counts.droppedRequests,
      droppedWebSockets: raw.counts.droppedWebSockets,
      droppedWsMessages: raw.counts.droppedWsMessages,
      maxRequests: raw.limits.maxRequests,
      maxWebSockets: raw.limits.maxWebSockets,
      maxWsMessages: raw.limits.maxWsMessages,
    }),
    insights: buildInsights(requests, webSockets),
    requests: parsed.view === "summary" ? [] : requests,
    webSockets: parsed.view === "summary" ? [] : webSockets,
  };
}

export async function targetNetworkCaptureEnd(opts: {
  captureId: string;
  timeoutMs: number;
  profile?: string;
  view?: string;
  fields?: string;
  urlContains?: string;
  method?: string;
  resourceType?: string;
  status?: string;
  failedOnly?: boolean;
}): Promise<TargetNetworkCaptureEndReport> {
  const { fs, path } = providers();
  const captureId = parseCaptureId(opts.captureId);
  const capture = await readNetworkCapture(captureId);
  if (!capture) {
    throw new CliError("E_QUERY_INVALID", `Capture ${captureId} not found`);
  }

  try {
    fs.mkdirSync(path.dirname(capture.stopSignalPath), { recursive: true });
    fs.writeFileSync(capture.stopSignalPath, "stop\n", "utf8");
  } catch {
    throw new CliError("E_INTERNAL", "Failed to signal capture stop");
  }

  const done = await waitForCaptureDone(capture.donePath, opts.timeoutMs);

  let primaryError: unknown = null;
  let report: TargetNetworkCaptureEndReport | null = null;

  try {
    if (done.status === "failed") {
      throw new CliError(
        "E_INTERNAL",
        done.message ? `Capture worker failed: ${done.message}` : "Capture worker failed",
      );
    }

    let raw: TargetNetworkReport;
    try {
      raw = JSON.parse(fs.readFileSync(capture.resultPath, "utf8")) as TargetNetworkReport;
    } catch {
      throw new CliError("E_INTERNAL", "Failed to read capture result");
    }

    const parsed = parseNetworkInput({
      profile: opts.profile ?? capture.profile,
      view: opts.view,
      fields: opts.fields,
      urlContains: opts.urlContains,
      method: opts.method,
      resourceType: opts.resourceType,
      status: opts.status,
      failedOnly: opts.failedOnly,
      maxRequests: raw.limits.maxRequests,
      maxWebSockets: raw.limits.maxWebSockets,
      maxWsMessages: raw.limits.maxWsMessages,
      captureMs: raw.capture.captureMs,
      includeHeaders: true,
      includePostData: true,
      includeWsMessages: true,
    });
    const projected = applyCapturedView(raw, parsed);

    report = {
      ...projected,
      status: done.status,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await finalizeNetworkCapture({
        captureId,
        status: done.status,
        endedAt: done.endedAt,
      });
    } catch (error) {
      if (!primaryError) {
        primaryError = error;
      }
    }
  }

  if (primaryError) {
    throw primaryError;
  }
  if (!report) {
    throw new CliError("E_INTERNAL", "Failed to build capture report");
  }
  return report;
}

export async function runTargetNetworkWorker(opts: {
  captureId: string;
  sessionId: string;
  targetId: string;
  actionId: string;
  resultPath: string;
  donePath: string;
  stopPath: string;
  maxRuntimeMs: number;
  profile: string;
  maxRequests: number;
  maxWebSockets: number;
  maxWsMessages: number;
  includeHeaders: boolean;
  includePostData: boolean;
  includeWsMessages: boolean;
}): Promise<void> {
  const { fs, path } = providers();
  try {
    const report = await targetNetwork({
      targetId: opts.targetId,
      sessionId: opts.sessionId,
      actionId: opts.actionId,
      timeoutMs: Math.max(20000, opts.maxRuntimeMs),
      captureId: opts.captureId,
      profile: opts.profile,
      view: "raw",
      fields: "id,method,status,durationMs,resourceType,url",
      captureMs: opts.maxRuntimeMs,
      maxRequests: opts.maxRequests,
      maxWebSockets: opts.maxWebSockets,
      maxWsMessages: opts.maxWsMessages,
      includeHeaders: opts.includeHeaders,
      includePostData: opts.includePostData,
      includeWsMessages: opts.includeWsMessages,
      stopSignalPath: opts.stopPath,
    });
    fs.mkdirSync(path.dirname(opts.resultPath), { recursive: true });
    fs.writeFileSync(opts.resultPath, `${JSON.stringify(report)}\n`, "utf8");
    fs.writeFileSync(opts.donePath, `${JSON.stringify({ status: "stopped", endedAt: nowIso(), message: null })}\n`, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "capture worker failed";
    fs.writeFileSync(opts.donePath, `${JSON.stringify({ status: "failed", endedAt: nowIso(), message })}\n`, "utf8");
  }
}

export function parseWorkerArgv(argv: string[]): {
  captureId: string;
  sessionId: string;
  targetId: string;
  actionId: string;
  resultPath: string;
  donePath: string;
  stopPath: string;
  maxRuntimeMs: number;
  profile: string;
  maxRequests: number;
  maxWebSockets: number;
  maxWsMessages: number;
  includeHeaders: boolean;
  includePostData: boolean;
  includeWsMessages: boolean;
} {
  const get = (name: string): string => {
    const idx = argv.indexOf(name);
    if (idx < 0 || idx + 1 >= argv.length) {
      throw new CliError("E_QUERY_INVALID", `Missing worker arg: ${name}`);
    }
    return argv[idx + 1] ?? "";
  };
  return {
    captureId: get("--capture-id"),
    sessionId: get("--session-id"),
    targetId: get("--target-id"),
    actionId: get("--action-id"),
    resultPath: get("--result-path"),
    donePath: get("--done-path"),
    stopPath: get("--stop-path"),
    maxRuntimeMs: parseNumberOrThrow(get("--max-runtime-ms"), "max-runtime-ms"),
    profile: get("--profile"),
    maxRequests: parseNumberOrThrow(get("--max-requests"), "max-requests"),
    maxWebSockets: parseNumberOrThrow(get("--max-websockets"), "max-websockets"),
    maxWsMessages: parseNumberOrThrow(get("--max-ws-messages"), "max-ws-messages"),
    includeHeaders: get("--include-headers") === "1",
    includePostData: get("--include-post-data") === "1",
    includeWsMessages: get("--include-ws-messages") === "1",
  };
}
