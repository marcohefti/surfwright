import { chromium, type Request, type Response, type WebSocket } from "playwright-core";
import { sanitizeActionId } from "./action-id.js";
import { readRecentTargetAction } from "./state-repos/target-repo.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "./targets.js";
import { parseNetworkInput, wsFramePreview } from "./target-network-utils.js";
import type { TargetNetworkTailReport } from "./types.js";

function resolveTailActionId(opts: {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function targetNetworkTail(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  actionId?: string;
  profile?: string;
  captureMs?: number;
  maxWsMessages?: number;
  reload?: boolean;
  includeWsMessages?: boolean;
  urlContains?: string;
  method?: string;
  resourceType?: string;
  status?: string;
  failedOnly?: boolean;
  onEvent: (event: Record<string, unknown>) => void;
}): Promise<TargetNetworkTailReport> {
  const targetId = sanitizeTargetId(opts.targetId);
  const parsed = parseNetworkInput({
    profile: opts.profile,
    captureMs: opts.captureMs,
    maxWsMessages: opts.maxWsMessages,
    reload: opts.reload,
    includeWsMessages: opts.includeWsMessages,
    urlContains: opts.urlContains,
    method: opts.method,
    resourceType: opts.resourceType,
    status: opts.status,
    failedOnly: opts.failedOnly,
  });
  const { session } = await resolveSessionForAction(opts.sessionId, opts.timeoutMs);
  const actionId = resolveTailActionId({
    actionId: opts.actionId,
    sessionId: session.sessionId,
    targetId,
  });
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const startedEpochMs = Date.now();
  let eventCount = 0;
  const counts = {
    requests: 0,
    responses: 0,
    failures: 0,
    webSockets: 0,
    wsMessages: 0,
  };

  const emit = (event: Record<string, unknown>) => {
    eventCount += 1;
    opts.onEvent(event);
  };

  try {
    const target = await resolveTargetHandle(browser, targetId);
    const requestMap = new WeakMap<Request, { id: number; startMs: number; method: string; url: string; resourceType: string }>();
    let nextRequestId = 1;
    let nextSocketId = 1;
    let wsMessagesStored = 0;

    const requestPassesStaticFilters = (req: { method: string; url: string; resourceType: string }) => {
      if (parsed.urlContains && !req.url.includes(parsed.urlContains)) {
        return false;
      }
      if (parsed.method && req.method !== parsed.method) {
        return false;
      }
      if (parsed.resourceType && req.resourceType !== parsed.resourceType) {
        return false;
      }
      return true;
    };

    const onRequest = (request: Request) => {
      const method = request.method().toUpperCase();
      const url = request.url();
      const resourceType = request.resourceType();
      const requestInfo = {
        id: nextRequestId,
        startMs: Math.max(0, Date.now() - startedEpochMs),
        method,
        url,
        resourceType,
      };
      nextRequestId += 1;
      requestMap.set(request, requestInfo);
      counts.requests += 1;
      if (!requestPassesStaticFilters(requestInfo)) {
        return;
      }
      emit({
        type: "request",
        phase: "start",
        sessionId: session.sessionId,
        targetId,
        actionId,
        ...requestInfo,
      });
    };

    const onResponse = (response: Response) => {
      counts.responses += 1;
      const request = response.request();
      const info = requestMap.get(request);
      if (!info || !requestPassesStaticFilters(info)) {
        return;
      }
      const status = response.status();
      if (parsed.statusFilter) {
        if (parsed.statusFilter.kind === "exact" && status !== parsed.statusFilter.value) {
          return;
        }
        if (parsed.statusFilter.kind === "class" && Math.floor(status / 100) !== parsed.statusFilter.value) {
          return;
        }
      }
      if (parsed.failedOnly) {
        return;
      }
      const endMs = Math.max(0, Date.now() - startedEpochMs);
      emit({
        type: "request",
        phase: "end",
        sessionId: session.sessionId,
        targetId,
        actionId,
        id: info.id,
        method: info.method,
        url: info.url,
        resourceType: info.resourceType,
        status,
        startMs: info.startMs,
        endMs,
        durationMs: Math.max(0, endMs - info.startMs),
      });
    };

    const onRequestFailed = (request: Request) => {
      counts.failures += 1;
      const info = requestMap.get(request);
      if (!info || !requestPassesStaticFilters(info)) {
        return;
      }
      const endMs = Math.max(0, Date.now() - startedEpochMs);
      emit({
        type: "request",
        phase: "failed",
        sessionId: session.sessionId,
        targetId,
        actionId,
        id: info.id,
        method: info.method,
        url: info.url,
        resourceType: info.resourceType,
        failure: request.failure()?.errorText ?? "request failed",
        startMs: info.startMs,
        endMs,
        durationMs: Math.max(0, endMs - info.startMs),
      });
    };

    const onWebSocket = (socket: WebSocket) => {
      const socketId = nextSocketId;
      nextSocketId += 1;
      const url = socket.url();
      if (parsed.urlContains && !url.includes(parsed.urlContains)) {
        return;
      }
      counts.webSockets += 1;
      emit({
        type: "websocket",
        phase: "open",
        sessionId: session.sessionId,
        targetId,
        actionId,
        id: socketId,
        url,
        atMs: Math.max(0, Date.now() - startedEpochMs),
      });
      const pushFrame = (direction: "sent" | "received", frame: { payload?: unknown; opcode?: unknown }) => {
        counts.wsMessages += 1;
        if (!parsed.includeWsMessages || wsMessagesStored >= parsed.maxWsMessages) {
          return;
        }
        wsMessagesStored += 1;
        const payload = wsFramePreview(frame.payload);
        emit({
          type: "websocket",
          phase: "frame",
          direction,
          sessionId: session.sessionId,
          targetId,
          actionId,
          id: socketId,
          url,
          atMs: Math.max(0, Date.now() - startedEpochMs),
          opcode: typeof frame.opcode === "number" ? frame.opcode : null,
          sizeBytes: payload.sizeBytes,
          preview: payload.preview,
        });
      };
      socket.on("framesent", (frame: { payload?: unknown; opcode?: unknown }) => pushFrame("sent", frame));
      socket.on("framereceived", (frame: { payload?: unknown; opcode?: unknown }) => pushFrame("received", frame));
      socket.on("socketerror", (error: string) => {
        emit({
          type: "websocket",
          phase: "error",
          sessionId: session.sessionId,
          targetId,
          actionId,
          id: socketId,
          url,
          atMs: Math.max(0, Date.now() - startedEpochMs),
          error,
        });
      });
      socket.on("close", () => {
        emit({
          type: "websocket",
          phase: "close",
          sessionId: session.sessionId,
          targetId,
          actionId,
          id: socketId,
          url,
          atMs: Math.max(0, Date.now() - startedEpochMs),
        });
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
      const deadline = Date.now() + parsed.captureMs;
      while (Date.now() < deadline) {
        await sleep(50);
      }
    } finally {
      target.page.off("request", onRequest);
      target.page.off("response", onResponse);
      target.page.off("requestfailed", onRequestFailed);
      target.page.off("websocket", onWebSocket);
    }

    const report: TargetNetworkTailReport = {
      ok: true,
      sessionId: session.sessionId,
      targetId,
      actionId,
      captureMs: parsed.captureMs,
      eventCount,
      counts,
    };
    emit({
      type: "capture",
      phase: "end",
      ...report,
    });
    return report;
  } finally {
    await browser.close();
  }
}
