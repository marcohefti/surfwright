import fs from "node:fs";
import { chromium, type Request, type Response, type WebSocket } from "playwright-core";
import { sanitizeActionId } from "../../action-id.js";
import { nowIso } from "../../state.js";
import { readRecentTargetAction, saveTargetSnapshot } from "../../state/index.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";
import { buildInsights, buildPerformanceSummary, buildTruncationHints, toTableRows } from "./target-network-analysis.js";
import {
  matchesRequestFilters,
  parseNetworkInput,
  postDataPreview,
  pushBackgroundTask,
  rounded,
  sleep,
  toRelativeMs,
  wsFramePreview,
} from "./target-network-utils.js";
import type {
  ParsedNetworkInput,
} from "./target-network-utils.js";
import type {
  TargetNetworkReport,
  TargetNetworkRequestReport,
  TargetNetworkWebSocketMessageReport,
  TargetNetworkWebSocketReport,
} from "../../types.js";

type MutableRequest = TargetNetworkRequestReport;
type MutableWebSocket = TargetNetworkWebSocketReport;
type NetworkCounts = TargetNetworkReport["counts"];
function resolveCaptureActionId(opts: {
  actionId?: string;
  sessionId: string;
  targetId: string;
}): string | null {
  if (typeof opts.actionId === "string" && opts.actionId.trim().length > 0) {
    return sanitizeActionId(opts.actionId);
  }
  return readRecentTargetAction({
    targetId: opts.targetId,
    sessionId: opts.sessionId,
  });
}

export async function targetNetwork(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  captureId?: string | null;
  actionId?: string;
  profile?: string;
  view?: string;
  fields?: string;
  captureMs?: number;
  maxRequests?: number;
  maxWebSockets?: number;
  maxWsMessages?: number;
  reload?: boolean;
  includeHeaders?: boolean;
  includePostData?: boolean;
  includeWsMessages?: boolean;
  urlContains?: string;
  method?: string;
  resourceType?: string;
  status?: string;
  failedOnly?: boolean;
  stopSignalPath?: string;
}): Promise<TargetNetworkReport> {
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseNetworkInput({
    profile: opts.profile,
    view: opts.view,
    fields: opts.fields,
    captureMs: opts.captureMs,
    maxRequests: opts.maxRequests,
    maxWebSockets: opts.maxWebSockets,
    maxWsMessages: opts.maxWsMessages,
    reload: opts.reload,
    includeHeaders: opts.includeHeaders,
    includePostData: opts.includePostData,
    includeWsMessages: opts.includeWsMessages,
    urlContains: opts.urlContains,
    method: opts.method,
    resourceType: opts.resourceType,
    status: opts.status,
    failedOnly: opts.failedOnly,
  });

  const { session, sessionSource } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: requestedTargetId,
  });
  const captureActionId = resolveCaptureActionId({
    actionId: opts.actionId,
    sessionId: session.sessionId,
    targetId: requestedTargetId,
  });
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    const captureStartedAtIso = nowIso();
    const captureStartEpochMs = Date.now();
    const requestByHandle = new WeakMap<Request, MutableRequest>();
    const requests: MutableRequest[] = [];
    const webSockets: MutableWebSocket[] = [];
    const backgroundTasks: Promise<void>[] = [];
    let wsMessagesStored = 0;
    let nextRequestId = 1;
    let nextWebSocketId = 1;

    const counts: NetworkCounts = {
      requestsSeen: 0,
      requestsReturned: 0,
      responsesSeen: 0,
      failedSeen: 0,
      webSocketsSeen: 0,
      webSocketsReturned: 0,
      wsMessagesSeen: 0,
      wsMessagesReturned: 0,
      droppedRequests: 0,
      droppedWebSockets: 0,
      droppedWsMessages: 0,
    };

    const onRequest = (request: Request) => {
      counts.requestsSeen += 1;
      if (requests.length >= parsed.maxRequests) {
        counts.droppedRequests += 1;
        return;
      }

      const record: MutableRequest = {
        id: nextRequestId,
        captureKey: `${opts.captureId ?? "live"}:req:${nextRequestId}`,
        actionId: captureActionId,
        redirectedFromId: null,
        url: request.url(),
        method: request.method().toUpperCase(),
        resourceType: request.resourceType(),
        navigation: request.isNavigationRequest(),
        startMs: toRelativeMs(captureStartEpochMs),
        endMs: null,
        durationMs: null,
        ttfbMs: null,
        status: null,
        ok: null,
        failure: null,
        bytesApprox: null,
      };
      nextRequestId += 1;
      requests.push(record);
      requestByHandle.set(request, record);
      const redirectedFrom = request.redirectedFrom();
      if (redirectedFrom) {
        const prev = requestByHandle.get(redirectedFrom);
        if (prev) {
          record.redirectedFromId = prev.id;
        }
      }

      if (parsed.includeHeaders || parsed.includePostData) {
        pushBackgroundTask(backgroundTasks, async () => {
          if (parsed.includeHeaders) {
            record.requestHeaders = await request.allHeaders();
          }
          if (parsed.includePostData) {
            const postData = request.postDataBuffer();
            record.postDataPreview = postData ? postDataPreview(postData) : null;
          }
        });
      }
    };

    const onResponse = (response: Response) => {
      counts.responsesSeen += 1;
      const request = response.request();
      const record = requestByHandle.get(request);
      if (!record) {
        return;
      }

      record.status = response.status();
      record.ok = response.ok();
      record.endMs = toRelativeMs(captureStartEpochMs);
      record.durationMs = Math.max(0, rounded(record.endMs - record.startMs));

      const timing = request.timing();
      if (Number.isFinite(timing.responseStart) && timing.responseStart >= 0) {
        record.ttfbMs = rounded(timing.responseStart);
      }

      pushBackgroundTask(backgroundTasks, async () => {
        const contentLengthRaw = await response.headerValue("content-length");
        if (contentLengthRaw !== null) {
          const parsedLength = Number.parseInt(contentLengthRaw, 10);
          if (Number.isFinite(parsedLength) && parsedLength >= 0) {
            record.bytesApprox = parsedLength;
          }
        }
        if (parsed.includeHeaders) {
          record.responseHeaders = await response.allHeaders();
        }
      });
    };

    const onRequestFailed = (request: Request) => {
      counts.failedSeen += 1;
      const record = requestByHandle.get(request);
      if (!record) {
        return;
      }
      record.failure = request.failure()?.errorText ?? "request failed";
      if (record.endMs === null) {
        record.endMs = toRelativeMs(captureStartEpochMs);
      }
      record.durationMs = Math.max(0, rounded((record.endMs ?? 0) - record.startMs));
    };

    const onWebSocket = (webSocket: WebSocket) => {
      counts.webSocketsSeen += 1;
      if (webSockets.length >= parsed.maxWebSockets) {
        counts.droppedWebSockets += 1;
        return;
      }

      const socket: MutableWebSocket = {
        id: nextWebSocketId,
        captureKey: `${opts.captureId ?? "live"}:ws:${nextWebSocketId}`,
        actionId: captureActionId,
        url: webSocket.url(),
        startMs: toRelativeMs(captureStartEpochMs),
        closeMs: null,
        durationMs: null,
        closed: false,
        error: null,
        messageCount: 0,
        messages: [],
      };
      nextWebSocketId += 1;
      webSockets.push(socket);

      const addMessage = (direction: "sent" | "received", frame: { payload?: unknown; opcode?: unknown }) => {
        counts.wsMessagesSeen += 1;
        socket.messageCount += 1;
        if (!parsed.includeWsMessages) {
          return;
        }
        if (wsMessagesStored >= parsed.maxWsMessages) {
          counts.droppedWsMessages += 1;
          return;
        }
        wsMessagesStored += 1;
        const payload = wsFramePreview(frame.payload);
        const message: TargetNetworkWebSocketMessageReport = {
          direction,
          atMs: toRelativeMs(captureStartEpochMs),
          opcode: typeof frame.opcode === "number" && Number.isFinite(frame.opcode) ? frame.opcode : null,
          sizeBytes: payload.sizeBytes,
          preview: payload.preview,
        };
        socket.messages.push(message);
      };

      webSocket.on("framesent", (frame: { payload?: unknown; opcode?: unknown }) => {
        addMessage("sent", frame);
      });
      webSocket.on("framereceived", (frame: { payload?: unknown; opcode?: unknown }) => {
        addMessage("received", frame);
      });
      webSocket.on("socketerror", (error: string) => {
        socket.error = typeof error === "string" && error.trim().length > 0 ? error.trim() : "socketerror";
      });
      webSocket.on("close", () => {
        socket.closed = true;
        socket.closeMs = toRelativeMs(captureStartEpochMs);
        socket.durationMs = Math.max(0, rounded((socket.closeMs ?? 0) - socket.startMs));
      });
    };

    target.page.on("request", onRequest);
    target.page.on("response", onResponse);
    target.page.on("requestfailed", onRequestFailed);
    target.page.on("websocket", onWebSocket);

    try {
      if (parsed.reload) {
        await target.page.reload({
          waitUntil: "domcontentloaded",
          timeout: opts.timeoutMs,
        });
      }
      await waitForCaptureEnd(parsed.captureMs, opts.stopSignalPath);
      await Promise.all(backgroundTasks);
    } finally {
      target.page.off("request", onRequest);
      target.page.off("response", onResponse);
      target.page.off("requestfailed", onRequestFailed);
      target.page.off("websocket", onWebSocket);
    }

    const filteredRequests = requests.filter((request) => matchesRequestFilters(request, parsed));
    const filteredWebSockets = filterWebSocketsByUrl(webSockets, parsed);
    const pageUrl = target.page.url();
    const pageTitle = await target.page.title();
    counts.requestsReturned = filteredRequests.length;
    counts.webSocketsReturned = filteredWebSockets.length;
    counts.wsMessagesReturned = filteredWebSockets.reduce((acc, socket) => acc + socket.messages.length, 0);

    const captureEndedAtIso = nowIso();
    const captureDurationMs = toRelativeMs(captureStartEpochMs);

    const hints = buildTruncationHints({
      droppedRequests: counts.droppedRequests,
      droppedWebSockets: counts.droppedWebSockets,
      droppedWsMessages: counts.droppedWsMessages,
      maxRequests: parsed.maxRequests,
      maxWebSockets: parsed.maxWebSockets,
      maxWsMessages: parsed.maxWsMessages,
    });
    const insights = buildInsights(filteredRequests, filteredWebSockets);
    const tableRows = parsed.view === "table" ? toTableRows(filteredRequests, parsed.fields) : [];
    const requestsOut = parsed.view === "summary" ? [] : filteredRequests;
    const webSocketsOut = parsed.view === "summary" ? [] : filteredWebSockets;

    const report: TargetNetworkReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      captureId: opts.captureId ?? null,
      actionId: captureActionId,
      url: pageUrl,
      title: pageTitle,
      capture: {
        startedAt: captureStartedAtIso,
        endedAt: captureEndedAtIso,
        durationMs: captureDurationMs,
        captureMs: parsed.captureMs,
        reload: parsed.reload,
      },
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
      tableRows,
      limits: {
        maxRequests: parsed.maxRequests,
        maxWebSockets: parsed.maxWebSockets,
        maxWsMessages: parsed.maxWsMessages,
      },
      counts,
      performance: buildPerformanceSummary(filteredRequests),
      truncated: {
        requests: counts.droppedRequests > 0,
        webSockets: counts.droppedWebSockets > 0,
        wsMessages: counts.droppedWsMessages > 0,
      },
      hints,
      insights,
      requests: requestsOut,
      webSockets: webSocketsOut,
    };

    await saveTargetSnapshot({
      targetId: report.targetId,
      sessionId: report.sessionId,
      url: report.url,
      title: report.title,
      status: null,
      updatedAt: nowIso(),
    });

    return report;
  } finally {
    await browser.close();
  }
}

function filterWebSocketsByUrl(webSockets: MutableWebSocket[], parsed: ParsedNetworkInput): MutableWebSocket[] {
  if (!parsed.urlContains) {
    return webSockets;
  }
  return webSockets.filter((socket) => socket.url.includes(parsed.urlContains ?? ""));
}

async function waitForCaptureEnd(captureMs: number, stopSignalPath?: string): Promise<void> {
  if (!stopSignalPath) {
    await sleep(captureMs);
    return;
  }
  const deadline = Date.now() + captureMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(stopSignalPath)) {
      return;
    }
    await sleep(150);
  }
}
